import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { fromZonedTime } from "date-fns-tz";

import { prisma } from "./db";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_AAD = Buffer.from("life-balance/google-calendar-token/v1", "utf8");
const CLIENT_SECRET_AAD_PREFIX =
  "life-balance/google-calendar-client-secret/v1/user/";
const OAUTH_STATE_KEY_CONTEXT =
  "life-balance/google-calendar-oauth-state-signing/v1";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SYNC_PAGES = 100;

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

const GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

export function hasRequiredGoogleCalendarScopes(scopes: string[]): boolean {
  const granted = new Set(scopes);

  return (
    granted.has(GOOGLE_CALENDAR_SCOPES[0]) &&
    (granted.has(GOOGLE_CALENDAR_SCOPES[1]) ||
      granted.has(GOOGLE_CALENDAR_EVENTS_WRITE_SCOPE))
  );
}

export const GOOGLE_OAUTH_STATE_COOKIE = "life_balance_google_oauth_state";

export const GOOGLE_OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: OAUTH_STATE_TTL_SECONDS,
  path: "/api/integrations/google/callback",
  priority: "high" as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

type GoogleErrorPayload = {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        status?: string;
      };
  error_description?: string;
};

export type GoogleTokenResponse = {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
  scopes: string[];
};

export type GoogleOAuthConfigurationSource = "environment" | "user";

export type GoogleOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  fingerprint: string;
  redirectUri: string;
  source: GoogleOAuthConfigurationSource;
};

export type GoogleConfigurationStatus = {
  clientIdMasked: string | null;
  configured: boolean;
  redirectUri: string;
  source: GoogleOAuthConfigurationSource | null;
  status: "configured" | "invalid" | "missing" | "server_unavailable";
};

export type GoogleOAuthStateVerification =
  | "config_changed"
  | "invalid"
  | "valid";

export type StoredGoogleAuthorization = {
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  scopes: string[];
  tokenExpiresAt: Date | null;
};

export type RefreshedGoogleAuthorization = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  scopes: string[];
  tokenExpiresAt: Date;
};

type GoogleTokenEndpointResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarInfo[];
  nextPageToken?: string;
};

export type GoogleCalendarInfo = {
  accessRole?: string;
  id: string;
  primary?: boolean;
  summary?: string;
  timeZone?: string;
};

export type GoogleCalendarEvent = {
  description?: string;
  end?: GoogleEventDate;
  htmlLink?: string;
  id?: string;
  location?: string;
  recurrence?: string[];
  recurringEventId?: string;
  start?: GoogleEventDate;
  status?: "cancelled" | "confirmed" | "tentative" | string;
  summary?: string;
  updated?: string;
};

type GoogleEventDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEventsListResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type GoogleSyncResult = {
  events: GoogleCalendarEvent[];
  fullSync: boolean;
  initialWindow: { timeMax: Date; timeMin: Date } | null;
  nextSyncToken: string;
  resetFromExpiredToken: boolean;
};

export type NormalizedGoogleEvent = {
  allDay: boolean;
  description: string | null;
  endAt: Date;
  externalId: string;
  location: string | null;
  recurrenceRule: string | null;
  startAt: Date;
  status: "CANCELLED" | "PLANNED";
  title: string;
};

export class GoogleCalendarError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "GoogleCalendarError";
    this.code = code;
    this.status = status;
  }
}

type StoredGoogleConfiguration = {
  clientId: string;
  clientSecretEncrypted: string;
  id: string;
  redirectUri: string | null;
  updatedAt: Date;
};

function googleNotConfiguredError(): GoogleCalendarError {
  return new GoogleCalendarError(
    "google_not_configured",
    "Google Calendar integration is not configured",
    503,
  );
}

export function getGoogleRedirectUri(
  requestOrigin: string,
  userConfiguredRedirect?: string | null,
): string {
  const configuredRedirect =
    userConfiguredRedirect?.trim() || process.env.GOOGLE_REDIRECT_URI?.trim();

  if (configuredRedirect) {
    return validateGoogleRedirectUri(configuredRedirect).toString();
  }

  const configuredAppUrl = process.env.APP_URL?.trim();
  const origin = configuredAppUrl
    ? validateHttpUrl(configuredAppUrl, "APP_URL")
    : validateHttpUrl(requestOrigin, "request origin");

  return validateGoogleRedirectUri(
    new URL("/api/integrations/google/callback", origin).toString(),
  ).toString();
}

function validateHttpUrl(value: string, label: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new GoogleCalendarError(
      "google_not_configured",
      `${label} must be a valid absolute URL`,
      503,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GoogleCalendarError(
      "google_not_configured",
      `${label} must use HTTP or HTTPS`,
      503,
    );
  }

  return url;
}

function validateGoogleRedirectUri(value: string): URL {
  const url = validateHttpUrl(value, "Google redirect URI");

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/integrations/google/callback"
  ) {
    throw new GoogleCalendarError(
      "google_redirect_uri_invalid",
      "Google redirect URI must point to this application's callback endpoint",
      503,
    );
  }

  const localDevelopmentHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !localDevelopmentHost
  ) {
    throw new GoogleCalendarError(
      "google_redirect_uri_insecure",
      "Google redirect URI must use HTTPS",
      503,
    );
  }

  return url;
}

async function loadStoredGoogleConfiguration(
  userId: string,
): Promise<StoredGoogleConfiguration | null> {
  return prisma.googleCalendarConfig.findUnique({
    where: { userId },
    select: {
      clientId: true,
      clientSecretEncrypted: true,
      id: true,
      redirectUri: true,
      updatedAt: true,
    },
  });
}

function buildResolvedGoogleConfiguration(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  source: GoogleOAuthConfigurationSource;
  version: string;
}): GoogleOAuthConfiguration {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();

  if (!clientId || !clientSecret) {
    throw googleNotConfiguredError();
  }

  // Validate the root key before starting OAuth. Without it, tokens could be
  // issued by Google but could not be persisted safely on callback.
  getTokenEncryptionKey();

  const fingerprint = createHash("sha256")
    .update(
      [
        "google-oauth-config-v1",
        input.source,
        input.version,
        clientId,
        clientSecret,
        input.redirectUri,
      ].join("\u0000"),
      "utf8",
    )
    .digest("base64url");

  return {
    clientId,
    clientSecret,
    fingerprint,
    redirectUri: input.redirectUri,
    source: input.source,
  };
}

export async function resolveGoogleOAuthConfiguration(
  userId: string,
  requestOrigin: string,
): Promise<GoogleOAuthConfiguration> {
  const stored = await loadStoredGoogleConfiguration(userId);

  if (stored) {
    return buildResolvedGoogleConfiguration({
      clientId: stored.clientId,
      clientSecret: decryptGoogleClientSecret(
        stored.clientSecretEncrypted,
        userId,
      ),
      redirectUri: getGoogleRedirectUri(requestOrigin, stored.redirectUri),
      source: "user",
      version: `${stored.id}:${stored.updatedAt.toISOString()}`,
    });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw googleNotConfiguredError();
  }

  return buildResolvedGoogleConfiguration({
    clientId,
    clientSecret,
    redirectUri: getGoogleRedirectUri(requestOrigin),
    source: "environment",
    version: "environment",
  });
}

export async function getGoogleConfigurationStatus(
  userId: string,
  requestOrigin: string,
): Promise<GoogleConfigurationStatus> {
  const stored = await loadStoredGoogleConfiguration(userId);
  const environmentClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  const environmentClientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
  const source: GoogleOAuthConfigurationSource | null = stored
    ? "user"
    : environmentClientId || environmentClientSecret
      ? "environment"
      : null;
  const clientId = stored?.clientId.trim() || environmentClientId;
  let redirectUri = "";

  try {
    redirectUri = getGoogleRedirectUri(requestOrigin, stored?.redirectUri);
  } catch {
    return {
      clientIdMasked: clientId ? maskGoogleClientId(clientId) : null,
      configured: false,
      redirectUri,
      source,
      status: "invalid",
    };
  }

  try {
    getTokenEncryptionKey();
  } catch {
    return {
      clientIdMasked: clientId ? maskGoogleClientId(clientId) : null,
      configured: false,
      redirectUri,
      source,
      status: "server_unavailable",
    };
  }

  try {
    const configuration = await resolveGoogleOAuthConfiguration(
      userId,
      requestOrigin,
    );

    return {
      clientIdMasked: maskGoogleClientId(configuration.clientId),
      configured: true,
      redirectUri: configuration.redirectUri,
      source: configuration.source,
      status: "configured",
    };
  } catch {
    return {
      clientIdMasked: clientId ? maskGoogleClientId(clientId) : null,
      configured: false,
      redirectUri,
      source,
      status: source ? "invalid" : "missing",
    };
  }
}

export function maskGoogleClientId(clientId: string): string {
  const normalized = clientId.trim();

  if (normalized.length <= 12) {
    return "••••••";
  }

  return `${normalized.slice(0, 6)}…${normalized.slice(-12)}`;
}

export function createGoogleOAuthState(
  userId: string,
  configurationFingerprint: string,
): {
  cookieValue: string;
  state: string;
} {
  const state = randomBytes(32).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1_000).toString(10);
  const signature = signOAuthState(
    state,
    issuedAt,
    userId,
    configurationFingerprint,
  );

  return {
    cookieValue: `v2.${state}.${issuedAt}.${configurationFingerprint}.${signature}`,
    state,
  };
}

export function verifyGoogleOAuthState(
  receivedState: string | null,
  cookieValue: string | undefined,
  userId: string,
  configurationFingerprint: string,
): GoogleOAuthStateVerification {
  if (!receivedState || !cookieValue) {
    return "invalid";
  }

  const [
    version,
    storedState,
    issuedAtValue,
    storedConfigurationFingerprint,
    storedSignature,
    ...rest
  ] = cookieValue.split(".");

  if (
    version !== "v2" ||
    !storedState ||
    !issuedAtValue ||
    !storedConfigurationFingerprint ||
    !storedSignature ||
    rest.length > 0 ||
    !safeStringEqual(receivedState, storedState)
  ) {
    return "invalid";
  }

  const issuedAt = Number(issuedAtValue);
  const now = Math.floor(Date.now() / 1_000);

  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 30 ||
    now - issuedAt > OAUTH_STATE_TTL_SECONDS
  ) {
    return "invalid";
  }

  const expectedSignature = signOAuthState(
    storedState,
    issuedAtValue,
    userId,
    storedConfigurationFingerprint,
  );

  if (!safeStringEqual(storedSignature, expectedSignature)) {
    return "invalid";
  }

  return safeStringEqual(
    storedConfigurationFingerprint,
    configurationFingerprint,
  )
    ? "valid"
    : "config_changed";
}

function signOAuthState(
  state: string,
  issuedAt: string,
  userId: string,
  configurationFingerprint: string,
): string {
  const signingKey = createHmac("sha256", getTokenEncryptionKey())
    .update(OAUTH_STATE_KEY_CONTEXT, "utf8")
    .digest();

  return createHmac("sha256", signingKey)
    .update(
      `v2:${state}:${issuedAt}:${userId}:${configurationFingerprint}`,
      "utf8",
    )
    .digest("base64url");
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function buildGoogleAuthorizationUrl(
  state: string,
  configuration: GoogleOAuthConfiguration,
): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  configuration: GoogleOAuthConfiguration,
): Promise<GoogleTokenResponse> {
  return requestGoogleTokens(
    new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: configuration.redirectUri,
    }),
  );
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  configuration: GoogleOAuthConfiguration,
): Promise<GoogleTokenResponse> {
  return requestGoogleTokens(
    new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

export async function getUsableGoogleAccessToken(
  authorization: StoredGoogleAuthorization,
  configuration: GoogleOAuthConfiguration,
  persistRefresh: (
    refreshed: RefreshedGoogleAuthorization,
  ) => Promise<void>,
  forceRefresh = false,
): Promise<string> {
  const accessTokenStillValid =
    authorization.accessTokenEncrypted &&
    authorization.tokenExpiresAt &&
    authorization.tokenExpiresAt.getTime() > Date.now() + 60_000;

  if (!forceRefresh && accessTokenStillValid) {
    return decryptGoogleToken(authorization.accessTokenEncrypted as string);
  }

  if (!authorization.refreshTokenEncrypted) {
    throw new GoogleCalendarError(
      "google_reconnect_required",
      "Google Calendar must be reconnected",
      401,
    );
  }

  const currentRefreshToken = decryptGoogleToken(
    authorization.refreshTokenEncrypted,
  );
  const refreshed = await refreshGoogleAccessToken(
    currentRefreshToken,
    configuration,
  );
  const refreshToken = refreshed.refreshToken ?? currentRefreshToken;
  const updatedAuthorization: RefreshedGoogleAuthorization = {
    accessTokenEncrypted: encryptGoogleToken(refreshed.accessToken),
    refreshTokenEncrypted: encryptGoogleToken(refreshToken),
    scopes: refreshed.scopes.length
      ? refreshed.scopes
      : authorization.scopes,
    tokenExpiresAt: refreshed.expiresAt,
  };

  await persistRefresh(updatedAuthorization);
  return refreshed.accessToken;
}

async function requestGoogleTokens(
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await safeFetch(GOOGLE_TOKEN_ENDPOINT, {
    body,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = await readJson<GoogleTokenEndpointResponse & GoogleErrorPayload>(
    response,
  );

  if (!response.ok || !payload?.access_token) {
    const oauthError =
      typeof payload?.error === "string" ? payload.error : undefined;
    const revoked = oauthError === "invalid_grant";

    throw new GoogleCalendarError(
      revoked ? "google_authorization_expired" : "google_token_exchange_failed",
      revoked
        ? "Google authorization has expired or was revoked"
        : "Google did not issue a usable access token",
      revoked ? 401 : 502,
    );
  }

  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 3_600;

  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1_000),
    refreshToken: payload.refresh_token ?? null,
    scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? [],
  };
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  const response = await safeFetch(GOOGLE_REVOKE_ENDPOINT, {
    body: new URLSearchParams({ token }),
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  return response.ok;
}

export async function getGooglePrimaryCalendar(
  accessToken: string,
): Promise<GoogleCalendarInfo> {
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const query = new URLSearchParams({
      maxResults: "250",
      minAccessRole: "reader",
      showHidden: "false",
    });

    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const payload = await googleCalendarRequest<GoogleCalendarListResponse>(
      accessToken,
      `/users/me/calendarList?${query}`,
    );
    const primary = payload.items?.find((calendar) => calendar.primary);

    if (primary?.id) {
      return primary;
    }

    if (!payload.nextPageToken) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  throw new GoogleCalendarError(
    "google_primary_calendar_missing",
    "The Google account has no accessible primary calendar",
    422,
  );
}

export async function pullGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
): Promise<GoogleSyncResult> {
  try {
    return await listGoogleCalendarEvents(
      accessToken,
      calendarId,
      syncToken,
      false,
    );
  } catch (error) {
    if (
      syncToken &&
      error instanceof GoogleCalendarError &&
      error.status === 410
    ) {
      return listGoogleCalendarEvents(accessToken, calendarId, null, true);
    }

    throw error;
  }
}

async function listGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
  resetFromExpiredToken: boolean,
): Promise<GoogleSyncResult> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const fullSync = !syncToken;
  const initialTimeMin = new Date();
  initialTimeMin.setUTCFullYear(initialTimeMin.getUTCFullYear() - 1);
  const initialTimeMax = new Date();
  initialTimeMax.setUTCFullYear(initialTimeMax.getUTCFullYear() + 2);

  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const query = new URLSearchParams({
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "true",
    });

    if (syncToken) {
      query.set("syncToken", syncToken);
    } else {
      query.set("timeMax", initialTimeMax.toISOString());
      query.set("timeMin", initialTimeMin.toISOString());
    }

    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const payload = await googleCalendarRequest<GoogleEventsListResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
    );

    if (payload.items) {
      events.push(...payload.items);
    }

    if (payload.nextPageToken) {
      pageToken = payload.nextPageToken;
      continue;
    }

    nextSyncToken = payload.nextSyncToken;
    break;
  }

  if (!nextSyncToken) {
    throw new GoogleCalendarError(
      "google_sync_incomplete",
      "Google Calendar sync did not reach its final page",
      502,
    );
  }

  return {
    events,
    fullSync,
    initialWindow: fullSync
      ? { timeMax: initialTimeMax, timeMin: initialTimeMin }
      : null,
    nextSyncToken,
    resetFromExpiredToken,
  };
}

async function googleCalendarRequest<T>(
  accessToken: string,
  path: string,
): Promise<T> {
  const response = await safeFetch(`${GOOGLE_CALENDAR_API}${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Consume the response but never surface Google's body because it can contain
    // account details that do not belong in client-facing errors or logs.
    await response.text().catch(() => undefined);

    if (response.status === 401) {
      throw new GoogleCalendarError(
        "google_access_token_rejected",
        "Google rejected the access token",
        401,
      );
    }

    if (response.status === 410) {
      throw new GoogleCalendarError(
        "google_sync_token_expired",
        "Google Calendar sync token expired",
        410,
      );
    }

    if (response.status === 403) {
      throw new GoogleCalendarError(
        "google_calendar_forbidden",
        "Google Calendar access was denied",
        403,
      );
    }

    if (response.status === 429) {
      throw new GoogleCalendarError(
        "google_rate_limited",
        "Google Calendar rate limit was reached",
        429,
      );
    }

    throw new GoogleCalendarError(
      "google_calendar_request_failed",
      "Google Calendar request failed",
      502,
    );
  }

  const payload = await readJson<T>(response);

  if (payload === null) {
    throw new GoogleCalendarError(
      "google_calendar_invalid_response",
      "Google Calendar returned an invalid response",
      502,
    );
  }

  return payload;
}

async function safeFetch(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      throw error;
    }

    throw new GoogleCalendarError(
      "google_unavailable",
      "Google is temporarily unavailable",
      503,
    );
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function normalizeGoogleCalendarEvent(
  event: GoogleCalendarEvent,
  userTimeZone: string,
): NormalizedGoogleEvent | null {
  if (!event.id) {
    return null;
  }

  if (event.status === "cancelled") {
    return {
      allDay: false,
      description: null,
      endAt: new Date(0),
      externalId: event.id,
      location: null,
      recurrenceRule: null,
      startAt: new Date(0),
      status: "CANCELLED",
      title: "",
    };
  }

  const start = parseGoogleEventDate(event.start, userTimeZone);
  const end = parseGoogleEventDate(event.end, userTimeZone);

  if (!start || !end || end.date <= start.date) {
    return null;
  }

  return {
    allDay: start.allDay,
    description: cleanOptionalText(event.description),
    endAt: end.date,
    externalId: event.id,
    location: cleanOptionalText(event.location),
    recurrenceRule: event.recurrence?.length
      ? event.recurrence.join("\n")
      : null,
    startAt: start.date,
    status: "PLANNED",
    title: cleanOptionalText(event.summary) ?? "Без названия",
  };
}

function parseGoogleEventDate(
  value: GoogleEventDate | undefined,
  userTimeZone: string,
): { allDay: boolean; date: Date } | null {
  if (value?.dateTime) {
    const date = new Date(value.dateTime);
    return Number.isNaN(date.getTime()) ? null : { allDay: false, date };
  }

  if (value?.date) {
    // Google all-day values are semantic calendar dates, not UTC instants. Map
    // local midnight in the user's IANA zone to UTC so negative-offset zones do
    // not render the event on the preceding day. Google's end date remains
    // exclusive because start and end use the same conversion.
    try {
      const date = fromZonedTime(`${value.date}T00:00:00.000`, userTimeZone);
      return Number.isNaN(date.getTime()) ? null : { allDay: true, date };
    } catch {
      return null;
    }
  }

  return null;
}

function cleanOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function encryptGoogleToken(token: string): string {
  if (!token) {
    throw new GoogleCalendarError(
      "google_token_invalid",
      "Cannot encrypt an empty Google token",
      500,
    );
  }

  return encryptGoogleValue(token, TOKEN_AAD);
}

export function decryptGoogleToken(encryptedToken: string): string {
  try {
    return decryptGoogleValue(encryptedToken, TOKEN_AAD);
  } catch {
    throw invalidEncryptedTokenError();
  }
}

export function encryptGoogleClientSecret(
  clientSecret: string,
  userId: string,
): string {
  const normalized = clientSecret.trim();

  if (!normalized) {
    throw new GoogleCalendarError(
      "google_client_secret_invalid",
      "Google OAuth client secret cannot be empty",
      422,
    );
  }

  return encryptGoogleValue(
    normalized,
    Buffer.from(`${CLIENT_SECRET_AAD_PREFIX}${userId}`, "utf8"),
  );
}

export function decryptGoogleClientSecret(
  encryptedClientSecret: string,
  userId: string,
): string {
  try {
    return decryptGoogleValue(
      encryptedClientSecret,
      Buffer.from(`${CLIENT_SECRET_AAD_PREFIX}${userId}`, "utf8"),
    );
  } catch {
    throw new GoogleCalendarError(
      "google_configuration_unreadable",
      "Stored Google Calendar configuration must be replaced",
      409,
    );
  }
}

function encryptGoogleValue(value: string, aad: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenEncryptionKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptGoogleValue(encryptedValue: string, aad: Buffer): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] =
    encryptedValue.split(".");

  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new Error("Invalid encrypted value envelope");
  }

  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid encrypted value envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTokenEncryptionKey(),
    iv,
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function invalidEncryptedTokenError(): GoogleCalendarError {
  return new GoogleCalendarError(
    "google_token_decryption_failed",
    "Stored Google authorization is unreadable; reconnect the account",
    401,
  );
}

function getTokenEncryptionKey(): Buffer {
  const configuredKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();

  if (!configuredKey) {
    throw new GoogleCalendarError(
      "google_encryption_not_configured",
      "Secure Google Calendar storage is not configured",
      503,
    );
  }

  const prefixedBase64 = configuredKey.match(/^base64:(.+)$/i)?.[1];
  const prefixedHex = configuredKey.match(/^hex:([a-f\d]+)$/i)?.[1];
  let key: Buffer | null = null;

  if (prefixedBase64) {
    key = decodeGoogleEncryptionKeyBase64(prefixedBase64);
  } else if (prefixedHex && prefixedHex.length === 64) {
    key = Buffer.from(prefixedHex, "hex");
  } else if (/^[a-f\d]{64}$/i.test(configuredKey)) {
    key = Buffer.from(configuredKey, "hex");
  } else {
    key = decodeGoogleEncryptionKeyBase64(configuredKey);
  }

  if (!key || key.length !== 32) {
    throw new GoogleCalendarError(
      "google_encryption_not_configured",
      "Secure Google Calendar storage is misconfigured",
      503,
    );
  }

  return key;
}

function decodeGoogleEncryptionKeyBase64(value: string): Buffer | null {
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
