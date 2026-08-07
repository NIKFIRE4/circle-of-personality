"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import styles from "./calendar-feed-card.module.css";

type CalendarProvider = "GOOGLE" | "APPLE";

type CalendarFeedConnection = {
  id: string;
  provider: CalendarProvider;
  displayName: string;
  connectedAt: string;
  lastSyncedAt: string | null;
  eventCount: number;
};

type SyncResult = {
  analyzed: number;
  categorized: number;
  classificationMode: "ai" | "local" | "mixed" | "skipped";
  imported: number;
  deleted: number;
  skipped: number;
  unchanged: boolean;
};

type ConnectionsPayload = {
  connections: CalendarFeedConnection[];
};

type ConnectPayload = {
  connection: CalendarFeedConnection;
  sync: SyncResult;
};

type SyncPayload = {
  sync: SyncResult;
};

type DisconnectPayload = {
  removedEvents: number;
};

export function CalendarFeedCard() {
  const [connections, setConnections] = useState<CalendarFeedConnection[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [canRetryLoading, setCanRetryLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void fetchConnections(controller.signal)
      .then(setConnections)
      .catch((cause) => {
        if (!isAbortError(cause)) {
          setCanRetryLoading(true);
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  async function retryLoading() {
    setLoading(true);
    setCanRetryLoading(false);
    setError("");

    try {
      setConnections(await fetchConnections());
    } catch (cause) {
      setCanRetryLoading(true);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function connectCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submittedUrl = url.trim();

    if (!isSupportedCalendarUrl(submittedUrl)) {
      setError("Вставьте полную ссылку, которая начинается с webcal:// или https://.");
      return;
    }

    setBusy("connect");
    setCanRetryLoading(false);
    setError("");
    setNotice("");

    try {
      const result = await requestJson<ConnectPayload>(
        "/api/integrations/calendar-feeds",
        {
          body: JSON.stringify({ url: submittedUrl }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      setConnections((current) => upsertConnection(current, result.connection));
      setUrl("");
      setNotice(syncSummary(result.sync, true));

      void refreshConnections(setConnections);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function syncConnection(connection: CalendarFeedConnection) {
    setBusy(`sync:${connection.id}`);
    setCanRetryLoading(false);
    setError("");
    setNotice("");

    try {
      const result = await requestJson<SyncPayload>(
        `/api/integrations/calendar-feeds/${encodeURIComponent(connection.id)}/sync`,
        { method: "POST" },
      );

      setNotice(syncSummary(result.sync, false));
      void refreshConnections(setConnections);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function disconnectConnection(connection: CalendarFeedConnection) {
    if (
      !window.confirm(
        `Отключить «${connection.displayName || providerName(connection.provider)}»? Импортированные из него события будут удалены из КОНТУР.КОСТРОВ.`,
      )
    ) {
      return;
    }

    setBusy(`disconnect:${connection.id}`);
    setCanRetryLoading(false);
    setError("");
    setNotice("");

    try {
      const result = await requestJson<DisconnectPayload>(
        `/api/integrations/calendar-feeds/${encodeURIComponent(connection.id)}`,
        { method: "DELETE" },
      );

      setConnections((current) =>
        current.filter((item) => item.id !== connection.id),
      );
      setNotice(
        result.removedEvents > 0
          ? `Календарь отключён. Удалено ${eventCountLabel(result.removedEvents)}.`
          : "Календарь отключён.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  const detectedProvider = detectProvider(url);
  const connectionCount = connections.length;

  return (
    <article className={`panel settings-card ${styles.card}`}>
      <header className={styles.header}>
        <div className={styles.logo} aria-hidden="true">
          <CalendarDays size={19} />
        </div>
        <div className={styles.heading}>
          <span className={styles.kicker}>Подписка по ссылке</span>
          <h2>Google и Apple Calendar</h2>
          <p>
            Подключите календарь по ссылке iCal/ICS — без входа, ключей и сложной
            настройки. События импортируются только для чтения, а ИИ распределяет
            задачи текущего месяца по вашим сферам жизни.
          </p>
        </div>
        {!loading && (
          <span
            className={`${styles.state} ${connectionCount ? styles.ready : styles.muted}`}
          >
            {connectionCount ? <Check size={12} /> : <Link2 size={12} />}
            {connectionCount
              ? `${connectionCount} ${calendarCountWord(connectionCount)}`
              : "Не подключено"}
          </span>
        )}
      </header>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {canRetryLoading && (
            <button type="button" onClick={() => void retryLoading()}>
              Повторить
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className={styles.notice} role="status" aria-live="polite">
          <Check size={14} aria-hidden="true" />
          {notice}
        </div>
      )}

      <form
        className={styles.connectForm}
        onSubmit={connectCalendar}
        aria-busy={busy === "connect"}
      >
        <div className={styles.formHeading}>
          <div>
            <strong>Ссылка на календарь</strong>
            <span>Google или Apple определятся автоматически</span>
          </div>
          <span className={styles.readOnlyBadge}>
            <ShieldCheck size={12} aria-hidden="true" /> Только чтение
          </span>
        </div>

        <label className={styles.field}>
          <span className={styles.srOnly}>Ссылка iCal или ICS</span>
          <div className={styles.inputRow}>
            <Link2 size={15} aria-hidden="true" />
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) setError("");
              }}
              name="calendarUrl"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              placeholder="webcal://… или https://…/calendar.ics"
              aria-describedby="calendar-feed-hint"
              disabled={busy !== null}
              required
            />
            {url.trim() && (
              <span className={styles.detected} aria-live="polite">
                {detectedProvider
                  ? providerName(detectedProvider)
                  : "iCal / ICS"}
              </span>
            )}
          </div>
        </label>

        <div className={styles.submitRow}>
          <p id="calendar-feed-hint">
            Нужна ссылка подписки на весь календарь. Ссылка на отдельное событие
            или приглашение не подойдёт.
          </p>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={busy !== null || !url.trim()}
          >
            {busy === "connect" ? (
              <LoaderCircle size={14} className={styles.spinner} />
            ) : (
              <Link2 size={14} />
            )}
            {busy === "connect" ? "Подключаем…" : "Подключить"}
          </button>
        </div>
      </form>

      <section
        className={styles.connections}
        aria-labelledby="connected-calendars-title"
        aria-busy={loading}
      >
        <div className={styles.sectionTitle}>
          <div>
            <strong id="connected-calendars-title">Подключённые календари</strong>
            <span>Сохранённые ссылки здесь не отображаются</span>
          </div>
        </div>

        {loading && (
          <div className={styles.loading} role="status">
            <LoaderCircle size={15} className={styles.spinner} />
            Загружаем подключения…
          </div>
        )}

        {!loading && connections.length === 0 && (
          <div className={styles.emptyState}>
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <strong>Пока ничего не подключено</strong>
              <span>Вставьте ссылку выше — первый импорт начнётся сразу.</span>
            </div>
          </div>
        )}

        <div className={styles.connectionList}>
          {connections.map((connection) => (
            <div className={styles.connection} key={connection.id}>
              <div
                className={styles.providerIcon}
                data-provider={connection.provider.toLowerCase()}
                aria-hidden="true"
              >
                {connection.provider === "GOOGLE" ? "G" : "A"}
              </div>
              <div className={styles.connectionCopy}>
                <div className={styles.connectionName}>
                  <strong>
                    {connection.displayName || providerName(connection.provider)}
                  </strong>
                  <span>{providerName(connection.provider)}</span>
                </div>
                <span className={styles.connectionMeta}>
                  {connection.lastSyncedAt
                    ? `Обновлён ${formatDate(connection.lastSyncedAt)}`
                    : `Подключён ${formatDate(connection.connectedAt)}`}
                  <i aria-hidden="true" />
                  {eventCountLabel(connection.eventCount)}
                </span>
              </div>
              <div className={styles.connectionActions}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void syncConnection(connection)}
                  disabled={busy !== null}
                >
                  {busy === `sync:${connection.id}` ? (
                    <LoaderCircle size={13} className={styles.spinner} />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Обновить
                </button>
                <button
                  className={styles.iconDangerButton}
                  type="button"
                  onClick={() => void disconnectConnection(connection)}
                  disabled={busy !== null}
                  aria-label={`Отключить ${connection.displayName || providerName(connection.provider)}`}
                  title="Отключить календарь"
                >
                  {busy === `disconnect:${connection.id}` ? (
                    <LoaderCircle size={14} className={styles.spinner} />
                  ) : (
                    <Unplug size={14} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <details className={styles.guide}>
        <summary>
          <span>
            <span className={styles.guideIcon} aria-hidden="true">
              ?
            </span>
            Где взять ссылку iCal / ICS
          </span>
          <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
        </summary>
        <div className={styles.guideContent}>
          <section>
            <span className={styles.providerLabel}>Google Calendar</span>
            <ol>
              <li>Откройте Google Calendar в браузере и зайдите в настройки.</li>
              <li>
                Выберите нужный календарь, затем раздел «Интеграция календаря».
              </li>
              <li>
                Скопируйте «Секретный адрес в формате iCal» и вставьте его выше.
              </li>
            </ol>
          </section>
          <section>
            <span className={styles.providerLabel}>Apple Calendar / iCloud</span>
            <ol>
              <li>Откройте Calendar на iCloud.com и нажмите значок доступа рядом с календарём.</li>
              <li>Включите «Общедоступный календарь» и скопируйте ссылку.</li>
              <li>Вставьте полученную webcal-ссылку выше.</li>
            </ol>
            <p className={styles.privacyWarning}>
              Важно: Apple создаёт публичную ссылку. Любой, у кого она есть, сможет
              читать события календаря. Используйте отдельный календарь без личных
              данных и отключите публикацию, если подписка больше не нужна.
            </p>
          </section>
        </div>
      </details>
    </article>
  );
}

async function fetchConnections(signal?: AbortSignal) {
  const result = await requestJson<ConnectionsPayload>(
    "/api/integrations/calendar-feeds",
    { cache: "no-store", signal },
  );

  return Array.isArray(result.connections) ? result.connections : [];
}

async function refreshConnections(
  update: (connections: CalendarFeedConnection[]) => void,
) {
  try {
    update(await fetchConnections());
  } catch {
    // The mutation already succeeded; keep its local result if refreshing metadata fails.
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      apiMessage(payload, "Не удалось выполнить операцию с календарём. Попробуйте ещё раз."),
    );
  }

  return payload as T;
}

function apiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const record = payload as {
    error?: unknown;
    message?: unknown;
  };

  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;

  if (record.error && typeof record.error === "object") {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return fallback;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Не удалось выполнить операцию с календарём. Попробуйте ещё раз.";
}

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function isSupportedCalendarUrl(value: string) {
  return /^(?:https|webcal):\/\/[^\s]+$/i.test(value);
}

function detectProvider(value: string): CalendarProvider | null {
  const normalized = value.trim().replace(/^webcal:/i, "https:");

  try {
    const host = new URL(normalized).hostname.toLowerCase();

    if (
      host === "calendar.google.com" ||
      host === "www.google.com"
    ) {
      return "GOOGLE";
    }

    if (
      host === "icloud.com" ||
      host.endsWith(".icloud.com")
    ) {
      return "APPLE";
    }
  } catch {
    return null;
  }

  return null;
}

function upsertConnection(
  current: CalendarFeedConnection[],
  connection: CalendarFeedConnection,
) {
  const exists = current.some((item) => item.id === connection.id);

  if (!exists) return [...current, connection];
  return current.map((item) => (item.id === connection.id ? connection : item));
}

function providerName(provider: CalendarProvider) {
  return provider === "GOOGLE" ? "Google Calendar" : "Apple Calendar";
}

function syncSummary(sync: SyncResult, initial: boolean) {
  const prefix = initial ? "Календарь подключён." : "Календарь обновлён.";

  if (sync.unchanged && sync.categorized === 0) {
    return `${prefix} Изменений нет.`;
  }

  const parts = [
    sync.imported > 0 ? `получено: ${sync.imported}` : "",
    sync.categorized > 0 ? `распределено по сферам: ${sync.categorized}` : "",
    sync.deleted > 0 ? `удалено: ${sync.deleted}` : "",
    sync.skipped > 0 ? `пропущено: ${sync.skipped}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return prefix;
  }

  return `${prefix} ${capitalize(parts.join(", "))}.`;
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "недавно";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function eventCountLabel(count: number) {
  const normalized = Math.max(0, count);
  return `${normalized} ${pluralize(normalized, "событие", "события", "событий")}`;
}

function calendarCountWord(count: number) {
  return pluralize(count, "календарь", "календаря", "календарей");
}

function pluralize(count: number, one: string, few: string, many: string) {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
