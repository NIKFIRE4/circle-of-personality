import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { fromZonedTime } from "date-fns-tz";
import ical, {
  type DateWithTimeZone,
  type EventInstance,
  type ParameterValue,
  type VEvent,
} from "node-ical";

export type CalendarFeedProvider = "APPLE" | "GOOGLE";

export type NormalizedCalendarFeedEvent = {
  allDay: boolean;
  description: string | null;
  endAt: Date;
  externalId: string;
  location: string | null;
  recurrenceRule: string | null;
  startAt: Date;
  title: string;
};

export type ParsedCalendarFeed = {
  displayName: string;
  events: NormalizedCalendarFeedEvent[];
  skipped: number;
};

export type CalendarFeedDownload =
  | {
      body: string;
      contentHash: string;
      etag: string | null;
      lastModified: string | null;
      notModified: false;
    }
  | {
      etag: string | null;
      lastModified: string | null;
      notModified: true;
    };

type ConditionalFeedRequest = {
  etag?: string | null;
  lastModified?: string | null;
};

const FEED_ENCRYPTION_AAD = Buffer.from(
  "life-balance/calendar-feed-url/v1",
  "utf8",
);
const FEED_FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_FEED_REDIRECTS = 3;
const MAX_IMPORTED_EVENTS = 5_000;
const MAX_CALENDAR_COMPONENTS = 10_000;

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

// 198.18.0.0/15 is intentionally not blocked: managed development and cloud
// runtimes commonly map allow-listed HTTPS destinations through that synthetic
// range. Provider host allow-listing and TLS certificate validation still apply.
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export class CalendarFeedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CalendarFeedError";
  }
}

export function normalizeCalendarFeedUrl(
  input: string,
  expectedProvider?: CalendarFeedProvider,
): { provider: CalendarFeedProvider; url: string } {
  const trimmed = input.trim();

  if (!trimmed || trimmed.length > 4_096) {
    throw new CalendarFeedError(
      "calendar_feed_url_invalid",
      "Введите корректную ссылку календаря",
      422,
    );
  }

  const httpsInput = trimmed.replace(/^webcal:\/\//i, "https://");
  let parsed: URL;

  try {
    parsed = new URL(httpsInput);
  } catch {
    throw new CalendarFeedError(
      "calendar_feed_url_invalid",
      "Введите полную ссылку iCal, начинающуюся с https:// или webcal://",
      422,
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new CalendarFeedError(
      "calendar_feed_url_invalid",
      "Поддерживаются только защищённые ссылки https:// и webcal://",
      422,
    );
  }

  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const pathname = parsed.pathname.toLowerCase();
  let provider: CalendarFeedProvider;

  if (hostname === "calendar.google.com" || hostname === "www.google.com") {
    provider = "GOOGLE";

    if (!pathname.includes("/calendar/ical/") || !pathname.endsWith(".ics")) {
      throw new CalendarFeedError(
        "calendar_feed_url_invalid",
        "Нужен адрес из раздела «Секретный адрес в формате iCal» Google Calendar",
        422,
      );
    }
  } else if (hostname === "icloud.com" || hostname.endsWith(".icloud.com")) {
    provider = "APPLE";

    if (!pathname.includes("/published/")) {
      throw new CalendarFeedError(
        "calendar_feed_url_invalid",
        "Нужна ссылка публичного календаря iCloud",
        422,
      );
    }
  } else {
    throw new CalendarFeedError(
      "calendar_feed_provider_unsupported",
      "Сейчас можно подключить ссылки Google Calendar и Apple iCloud",
      422,
    );
  }

  if (expectedProvider && provider !== expectedProvider) {
    throw new CalendarFeedError(
      "calendar_feed_redirect_rejected",
      "Провайдер календаря изменился во время загрузки",
      502,
    );
  }

  return { provider, url: parsed.toString() };
}

export function calendarFeedExternalAccountId(url: string): string {
  return `ical:${createHash("sha256").update(url, "utf8").digest("hex")}`;
}

export function encryptCalendarFeedUrl(url: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getCalendarFeedEncryptionKey(),
    iv,
  );
  cipher.setAAD(FEED_ENCRYPTION_AAD);
  const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);

  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCalendarFeedUrl(encryptedUrl: string): string {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] =
      encryptedUrl.split(".");

    if (
      version !== "v1" ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext ||
      rest.length
    ) {
      throw new Error("Invalid encrypted calendar URL");
    }

    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");

    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
      throw new Error("Invalid encrypted calendar URL");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getCalendarFeedEncryptionKey(),
      iv,
    );
    decipher.setAAD(FEED_ENCRYPTION_AAD);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof CalendarFeedError) throw error;

    throw new CalendarFeedError(
      "calendar_feed_url_unreadable",
      "Сохранённую ссылку календаря больше нельзя прочитать. Подключите её заново",
      409,
    );
  }
}

export async function downloadCalendarFeed(
  normalizedUrl: string,
  provider: CalendarFeedProvider,
  conditional: ConditionalFeedRequest = {},
): Promise<CalendarFeedDownload> {
  let currentUrl = normalizedUrl;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_FEED_REDIRECTS; redirectCount += 1) {
      const normalized = normalizeCalendarFeedUrl(currentUrl, provider);
      await assertPublicCalendarFeedTarget(normalized.url);

      const headers = new Headers({
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Kontur-Calendar-Subscription/1.0",
      });

      if (conditional.etag) headers.set("if-none-match", conditional.etag);
      if (conditional.lastModified) {
        headers.set("if-modified-since", conditional.lastModified);
      }

      const response = await fetch(normalized.url, {
        cache: "no-store",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");

        if (!location || redirectCount === MAX_FEED_REDIRECTS) {
          throw new CalendarFeedError(
            "calendar_feed_redirect_rejected",
            "Ссылка календаря перенаправляет слишком много раз",
            502,
          );
        }

        currentUrl = new URL(location, normalized.url).toString();
        continue;
      }

      const etag = safeHeader(response.headers.get("etag"));
      const lastModified = safeHeader(response.headers.get("last-modified"));

      if (response.status === 304) {
        return { etag, lastModified, notModified: true };
      }

      if (!response.ok) {
        const inaccessible = [401, 403, 404, 410].includes(response.status);
        throw new CalendarFeedError(
          inaccessible
            ? "calendar_feed_inaccessible"
            : "calendar_feed_download_failed",
          inaccessible
            ? "Календарь недоступен по этой ссылке. Проверьте, что ссылка ещё активна"
            : "Не удалось загрузить календарь. Попробуйте позже",
          inaccessible ? 422 : 502,
        );
      }

      const body = await readLimitedResponse(response);

      if (!/^\uFEFF?\s*BEGIN:VCALENDAR\b/im.test(body) || !/END:VCALENDAR\s*$/im.test(body)) {
        throw new CalendarFeedError(
          "calendar_feed_invalid_content",
          "По ссылке не найден календарь в формате iCal",
          422,
        );
      }

      return {
        body,
        contentHash: createHash("sha256").update(body, "utf8").digest("hex"),
        etag,
        lastModified,
        notModified: false,
      };
    }
  } catch (error) {
    if (error instanceof CalendarFeedError) throw error;

    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new CalendarFeedError(
        "calendar_feed_timeout",
        "Календарь не ответил вовремя. Попробуйте позже",
        504,
      );
    }

    throw new CalendarFeedError(
      "calendar_feed_unavailable",
      "Не удалось связаться с календарём. Проверьте ссылку и попробуйте позже",
      502,
    );
  }

  throw new CalendarFeedError(
    "calendar_feed_redirect_rejected",
    "Не удалось перейти по ссылке календаря",
    502,
  );
}

export async function parseCalendarFeed(
  body: string,
  provider: CalendarFeedProvider,
  userTimeZone: string,
  now = new Date(),
): Promise<ParsedCalendarFeed> {
  let calendar;

  try {
    calendar = await ical.async.parseICS(body);
  } catch {
    throw new CalendarFeedError(
      "calendar_feed_parse_failed",
      "Не удалось прочитать события из календаря",
      422,
    );
  }

  const rangeStart = new Date(now);
  rangeStart.setUTCFullYear(rangeStart.getUTCFullYear() - 1);
  const rangeEnd = new Date(now);
  rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 2);
  const normalized = new Map<string, NormalizedCalendarFeedEvent>();
  let componentCount = 0;
  let skipped = 0;

  for (const component of Object.values(calendar)) {
    if (!component || component.type !== "VEVENT") continue;
    componentCount += 1;

    if (componentCount > MAX_CALENDAR_COMPONENTS) {
      throw feedTooLargeError();
    }

    if (!component.uid || !component.start || component.recurrenceid) {
      skipped += 1;
      continue;
    }

    const recurrenceRule = component.rrule?.toString() ?? null;

    if (recurrenceRule && /FREQ=(?:SECONDLY|MINUTELY|HOURLY)\b/i.test(recurrenceRule)) {
      throw new CalendarFeedError(
        "calendar_feed_recurrence_too_frequent",
        "Календарь содержит слишком частое повторение, которое нельзя безопасно импортировать",
        422,
      );
    }

    let instances: EventInstance[];

    try {
      instances = ical.expandRecurringEvent(component, {
        expandOngoing: true,
        excludeExdates: true,
        from: rangeStart,
        includeOverrides: true,
        to: rangeEnd,
      });
    } catch {
      skipped += 1;
      continue;
    }

    if (normalized.size + instances.length > MAX_IMPORTED_EVENTS) {
      throw feedTooLargeError();
    }

    for (const instance of instances) {
      const event = normalizeEventInstance(
        component,
        instance,
        userTimeZone,
        recurrenceRule,
      );

      if (!event) {
        skipped += 1;
        continue;
      }

      normalized.set(event.externalId, event);
    }
  }

  return {
    displayName:
      cleanText(calendar.vcalendar?.["WR-CALNAME"], 200) ??
      (provider === "APPLE" ? "Календарь Apple" : "Календарь Google"),
    events: [...normalized.values()].sort(
      (left, right) => left.startAt.getTime() - right.startAt.getTime(),
    ),
    skipped,
  };
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return !blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return !blockedIpv6Addresses.check(address, "ipv6");
  return false;
}

async function assertPublicCalendarFeedTarget(url: string): Promise<void> {
  const hostname = new URL(url).hostname;
  let addresses: Array<{ address: string; family: number }>;

  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CalendarFeedError(
      "calendar_feed_host_unavailable",
      "Не удалось найти сервер календаря",
      502,
    );
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new CalendarFeedError(
      "calendar_feed_host_rejected",
      "Адрес сервера календаря запрещён",
      422,
    );
  }
}

function normalizeEventInstance(
  baseEvent: VEvent,
  instance: EventInstance,
  userTimeZone: string,
  recurrenceRule: string | null,
): NormalizedCalendarFeedEvent | null {
  const instanceEvent = instance.event;

  if (instanceEvent.status === "CANCELLED") return null;

  const dates = normalizeEventDates(
    instance.start,
    instance.end,
    instance.isFullDay,
    userTimeZone,
  );

  if (!dates || dates.endAt <= dates.startAt) return null;

  const recurrenceIdentity = instance.isRecurring
    ? instanceEvent.recurrenceid?.toISOString() ?? instance.start.toISOString()
    : "single";
  const externalId = `ics:${createHash("sha256")
    .update(`${baseEvent.uid}\0${recurrenceIdentity}`, "utf8")
    .digest("hex")}`;

  return {
    allDay: instance.isFullDay,
    description: cleanText(instanceEvent.description, 10_000),
    endAt: dates.endAt,
    externalId,
    location: cleanText(instanceEvent.location, 500),
    recurrenceRule: recurrenceRule?.slice(0, 1_024) ?? null,
    startAt: dates.startAt,
    title: cleanText(instanceEvent.summary ?? instance.summary, 200) ?? "Без названия",
  };
}

function normalizeEventDates(
  start: DateWithTimeZone,
  end: DateWithTimeZone,
  allDay: boolean,
  userTimeZone: string,
): { endAt: Date; startAt: Date } | null {
  if (!isValidDate(start) || !isValidDate(end)) return null;

  if (!allDay) {
    return { endAt: new Date(end), startAt: new Date(start) };
  }

  try {
    const startAt = fromZonedTime(
      `${semanticCalendarDate(start)}T00:00:00.000`,
      userTimeZone,
    );
    const endAt = fromZonedTime(
      `${semanticCalendarDate(end)}T00:00:00.000`,
      userTimeZone,
    );
    return { endAt, startAt };
  } catch {
    return null;
  }
}

function semanticCalendarDate(value: DateWithTimeZone): string {
  if (value.dateOnly && !value.tz) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: value.tz ?? "UTC",
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function cleanText(value: ParameterValue | string | undefined, maximum: number): string | null {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "val" in value
        ? String(value.val)
        : "";
  const normalized = raw.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function safeHeader(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/[\r\n]/g, "").slice(0, 512) || null;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
    throw feedTooLargeError();
  }

  if (!response.body) {
    throw new CalendarFeedError(
      "calendar_feed_empty",
      "Календарь вернул пустой ответ",
      422,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let body = "";
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;

    if (received > MAX_FEED_BYTES) {
      await reader.cancel();
      throw feedTooLargeError();
    }

    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return body;
}

function feedTooLargeError(): CalendarFeedError {
  return new CalendarFeedError(
    "calendar_feed_too_large",
    "Календарь слишком большой для безопасного импорта",
    422,
  );
}

function getCalendarFeedEncryptionKey(): Buffer {
  const configured = (
    process.env.CALENDAR_FEED_ENCRYPTION_KEY ??
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  )?.trim();

  if (!configured) {
    throw new CalendarFeedError(
      "calendar_feed_encryption_not_configured",
      "Защищённое хранение календарей не настроено на сервере",
      503,
    );
  }

  const base64 = configured.match(/^base64:(.+)$/i)?.[1];
  const prefixedHex = configured.match(/^hex:([a-f\d]+)$/i)?.[1];
  let key: Buffer | null = null;

  if (base64) {
    key = decodeBase64Key(base64);
  } else if (prefixedHex && prefixedHex.length === 64) {
    key = Buffer.from(prefixedHex, "hex");
  } else if (/^[a-f\d]{64}$/i.test(configured)) {
    key = Buffer.from(configured, "hex");
  } else {
    key = decodeBase64Key(configured);
  }

  if (!key || key.length !== 32) {
    throw new CalendarFeedError(
      "calendar_feed_encryption_not_configured",
      "Защищённое хранение календарей настроено неверно",
      503,
    );
  }

  return key;
}

function decodeBase64Key(value: string): Buffer | null {
  const normalized = value.trim();
  const paddingIndex = normalized.indexOf("=");

  if (
    !normalized ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized) ||
    (paddingIndex !== -1 && paddingIndex < normalized.length - 2)
  ) {
    return null;
  }

  try {
    return Buffer.from(
      normalized,
      normalized.includes("-") || normalized.includes("_")
        ? "base64url"
        : "base64",
    );
  } catch {
    return null;
  }
}
