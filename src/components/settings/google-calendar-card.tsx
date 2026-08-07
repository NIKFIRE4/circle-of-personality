"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Check,
  Clipboard,
  CloudDownload,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Trash2,
  Unplug,
} from "lucide-react";

import styles from "./google-calendar-card.module.css";

type ConfigurationStatus = {
  clientIdMasked: string | null;
  configured: boolean;
  redirectUri: string;
  source: "environment" | "user" | null;
  status: "configured" | "invalid" | "missing" | "server_unavailable";
};

type GoogleConnection = {
  accountEmail: string | null;
  connectedAt: string;
  id: string;
  lastSyncedAt: string | null;
  requiresReconnect: boolean;
};

type GoogleStatus = {
  accounts: GoogleConnection[];
  configured: boolean;
  configuration: ConfigurationStatus;
  connected: boolean;
  provider: "GOOGLE";
};

type SyncPayload = {
  failed?: Array<{ code: string; connectionId: string }>;
  synced?: Array<{
    analyzed: number;
    categorized: number;
    classificationMode: "ai" | "local" | "mixed" | "skipped";
    connectionId: string;
    deleted: number;
    imported: number;
    mode: "full" | "incremental";
    skipped: number;
  }>;
};

type DisconnectPayload = {
  removedEvents: number;
};

type CallbackResult = {
  connectionId: string | null;
  reason: string | null;
  requestInitialSync: boolean;
  status: "connected" | "error";
};

class GoogleUiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function GoogleCalendarCard() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingConfiguration, setEditingConfiguration] = useState(false);

  useEffect(() => {
    const callback = consumeCallbackResult();
    const callbackError =
      callback?.status === "error"
        ? messageForCode(callback.reason || "google_authorization_failed")
        : "";

    void (async () => {
      try {
        const current = await fetchGoogleStatus();
        setStatus(current);
        setEditingConfiguration(!current.configured);

        if (callbackError) {
          setError(callbackError);
        }

        if (
          callback?.status === "connected" &&
          callback.requestInitialSync &&
          callback.connectionId
        ) {
          setNotice("Google Calendar подключён. Выполняем первый импорт…");
          setBusy(`sync:${callback.connectionId}`);
          const result = await requestJson<SyncPayload>(
            `/api/integrations/google/sync?connectionId=${encodeURIComponent(callback.connectionId)}`,
            { method: "POST" },
          );
          setNotice(syncSummary(result, true));
          setStatus(await fetchGoogleStatus());
        } else if (callback?.status === "connected") {
          setNotice("Google Calendar подключён.");
        }
      } catch (cause) {
        setNotice("");
        setError(callbackError || errorMessage(cause));
        setStatus((current) => current);
      } finally {
        setBusy(null);
      }
    })();
  }, []);

  async function reloadStatus() {
    const next = await fetchGoogleStatus();
    setStatus(next);
    return next;
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("config-save");
    setError("");
    setNotice("");

    try {
      const form = event.currentTarget;
      const data = new FormData(form);
      await requestJson<ConfigurationStatus>(
        "/api/integrations/google/config",
        {
          body: JSON.stringify({
            clientId: data.get("clientId"),
            clientSecret: data.get("clientSecret"),
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      );
      form.reset();
      const next = await reloadStatus();
      setEditingConfiguration(!next.configured);
      setNotice("OAuth-данные сохранены. Теперь можно подключить аккаунт.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function deleteConfiguration() {
    if (
      !window.confirm(
        "Удалить сохранённые OAuth-данные? Серверная конфигурация, если она есть, станет активной снова.",
      )
    ) {
      return;
    }

    setBusy("config-delete");
    setError("");
    setNotice("");

    try {
      await requestJson("/api/integrations/google/config", {
        method: "DELETE",
      });
      const next = await reloadStatus();
      setEditingConfiguration(!next.configured);
      setNotice("Пользовательские OAuth-данные удалены.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function syncConnection(connectionId: string) {
    setBusy(`sync:${connectionId}`);
    setError("");
    setNotice("");

    try {
      const result = await requestJson<SyncPayload>(
        `/api/integrations/google/sync?connectionId=${encodeURIComponent(connectionId)}`,
        { method: "POST" },
      );
      setNotice(syncSummary(result, false));
      await reloadStatus();
    } catch (cause) {
      setError(errorMessage(cause));
      await reloadStatus().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function disconnectConnection(connection: GoogleConnection) {
    const account = connection.accountEmail || "этот Google-аккаунт";

    if (
      !window.confirm(
        `Отключить ${account}? Импортированные из него события будут удалены из КОНТУР.КОСТРОВ.`,
      )
    ) {
      return;
    }

    setBusy(`disconnect:${connection.id}`);
    setError("");
    setNotice("");

    try {
      const result = await requestJson<DisconnectPayload>(
        `/api/integrations/google/disconnect?connectionId=${encodeURIComponent(connection.id)}`,
        { method: "POST" },
      );
      await reloadStatus();
      setNotice(
        result.removedEvents > 0
          ? `Аккаунт отключён. Удалено импортированных событий: ${result.removedEvents}.`
          : "Google-аккаунт отключён.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function copyRedirectUri() {
    const redirectUri = status?.configuration.redirectUri;

    if (!redirectUri) return;

    try {
      await navigator.clipboard.writeText(redirectUri);
      setNotice("Redirect URI скопирован.");
    } catch {
      setError("Не удалось скопировать адрес. Выделите его вручную.");
    }
  }

  const configuration = status?.configuration;
  const hasConnections = Boolean(status?.accounts.length);
  const canEditConfiguration = !hasConnections;
  const configurationUnavailable =
    configuration?.status === "server_unavailable";

  return (
    <article className={`panel settings-card ${styles.card}`}>
      <header className={styles.header}>
        <div className={styles.logo} aria-hidden="true">
          G
        </div>
        <div className={styles.heading}>
          <span className={styles.kicker}>Интеграция календаря</span>
          <h2>Google Calendar</h2>
          <p>
            Односторонний безопасный импорт событий. Изменения в КОНТУР.КОСТРОВ не
            отправляются в Google. После импорта ИИ распределит задачи текущего
            месяца по вашим сферам жизни.
          </p>
        </div>
        {configuration && (
          <span
            className={`${styles.state} ${configuration.configured ? styles.ready : styles.muted}`}
          >
            {configuration.configured ? <Check size={12} /> : <KeyRound size={12} />}
            {configuration.configured ? "Настроено" : "Нужны ключи"}
          </span>
        )}
      </header>

      {!status && !error && (
        <div className={styles.loading}>
          <LoaderCircle size={16} className={styles.spinner} /> Проверяем
          подключение…
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}

      {configuration && (
        <section className={styles.configuration}>
          <div className={styles.sectionTitle}>
            <div>
              <strong>OAuth-приложение</strong>
              <span>
                {configuration.source === "user"
                  ? `Ваш Client ID: ${configuration.clientIdMasked || "скрыт"}`
                  : configuration.source === "environment"
                    ? `Серверная конфигурация: ${configuration.clientIdMasked || "скрыта"}`
                    : "Добавьте данные Web OAuth client из Google Cloud"}
              </span>
            </div>
            {canEditConfiguration && configuration.configured && (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setEditingConfiguration((value) => !value)}
              >
                <Settings2 size={13} />
                {editingConfiguration ? "Скрыть" : "Настроить"}
              </button>
            )}
          </div>

          {configuration.redirectUri && (
            <div className={styles.redirectBox}>
              <Link2 size={14} />
              <div>
                <span>Разрешённый Redirect URI в Google Cloud</span>
                <code>{configuration.redirectUri}</code>
              </div>
              <button
                type="button"
                onClick={copyRedirectUri}
                aria-label="Скопировать Redirect URI"
              >
                <Clipboard size={14} />
              </button>
            </div>
          )}

          {configurationUnavailable && (
            <p className={styles.helpText}>
              Серверное шифрование секретов не настроено. Добавление OAuth-данных
              временно недоступно — обратитесь к владельцу установки.
            </p>
          )}

          {editingConfiguration && canEditConfiguration && (
            <form className={styles.form} onSubmit={saveConfiguration}>
              <p className={styles.helpText}>
                В Google Cloud включите Calendar API, создайте OAuth client типа
                Web application и добавьте указанный Redirect URI. Client Secret
                после сохранения больше не показывается.
              </p>
              <label>
                <span>Client ID</span>
                <input
                  name="clientId"
                  autoComplete="off"
                  placeholder="…apps.googleusercontent.com"
                  minLength={8}
                  maxLength={512}
                  required
                  disabled={configurationUnavailable}
                />
              </label>
              <label>
                <span>Client Secret</span>
                <input
                  name="clientSecret"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Введите секрет заново"
                  minLength={8}
                  maxLength={4096}
                  required
                  disabled={configurationUnavailable}
                />
              </label>
              <div className={styles.formActions}>
                {configuration.source === "user" && (
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={deleteConfiguration}
                    disabled={busy !== null}
                  >
                    <Trash2 size={13} /> Удалить мои ключи
                  </button>
                )}
                <button
                  className={styles.primaryButton}
                  disabled={busy !== null || configurationUnavailable}
                >
                  {busy === "config-save" ? (
                    <LoaderCircle size={13} className={styles.spinner} />
                  ) : (
                    <KeyRound size={13} />
                  )}
                  Сохранить OAuth-данные
                </button>
              </div>
            </form>
          )}

          {!canEditConfiguration && (
            <p className={styles.helpText}>
              Чтобы заменить OAuth-данные, сначала отключите все Google-аккаунты.
            </p>
          )}
        </section>
      )}

      {status?.accounts.map((connection) => (
        <section className={styles.connection} key={connection.id}>
          <div className={styles.connectionIcon}>
            <CloudDownload size={17} />
          </div>
          <div className={styles.connectionCopy}>
            <strong>{connection.accountEmail || "Основной календарь Google"}</strong>
            <span>
              {connection.requiresReconnect
                ? "Доступ истёк — требуется переподключение"
                : connection.lastSyncedAt
                  ? `Обновлено ${formatDate(connection.lastSyncedAt)}`
                  : "Ожидает первого импорта"}
            </span>
          </div>
          <div className={styles.connectionActions}>
            {connection.requiresReconnect ? (
              <a
                className={styles.primaryButton}
                href="/api/integrations/google/start"
              >
                <RefreshCw size={13} /> Переподключить
              </a>
            ) : (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => syncConnection(connection.id)}
                disabled={busy !== null}
              >
                {busy === `sync:${connection.id}` ? (
                  <LoaderCircle size={13} className={styles.spinner} />
                ) : (
                  <RefreshCw size={13} />
                )}
                Обновить
              </button>
            )}
            <button
              className={styles.iconDangerButton}
              type="button"
              onClick={() => disconnectConnection(connection)}
              disabled={busy !== null}
              aria-label={`Отключить ${connection.accountEmail || "Google Calendar"}`}
            >
              {busy === `disconnect:${connection.id}` ? (
                <LoaderCircle size={14} className={styles.spinner} />
              ) : (
                <Unplug size={14} />
              )}
            </button>
          </div>
        </section>
      ))}

      {status?.configured && (
        <div className={styles.connectRow}>
          <div>
            <strong>{hasConnections ? "Другой аккаунт" : "Подключить календарь"}</strong>
            <span>Google отдельно запросит разрешение только на чтение.</span>
          </div>
          <a className={styles.primaryButton} href="/api/integrations/google/start">
            <CloudDownload size={13} />
            {hasConnections ? "Добавить" : "Подключить"}
          </a>
        </div>
      )}
    </article>
  );
}

async function fetchGoogleStatus(): Promise<GoogleStatus> {
  return requestJson<GoogleStatus>("/api/integrations/google/status");
}

async function requestJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string } | string;
  } & T;

  if (!response.ok) {
    const structuredError =
      payload.error && typeof payload.error === "object" ? payload.error : null;
    throw new GoogleUiError(
      structuredError?.code || "GOOGLE_REQUEST_FAILED",
      structuredError?.message ||
        (typeof payload.error === "string" ? payload.error : "Google request failed"),
    );
  }

  return payload;
}

function consumeCallbackResult(): CallbackResult | null {
  const url = new URL(window.location.href);

  if (url.searchParams.get("integration") !== "google") {
    return null;
  }

  const rawStatus = url.searchParams.get("status");
  const result: CallbackResult = {
    connectionId: url.searchParams.get("connectionId"),
    reason: url.searchParams.get("reason"),
    requestInitialSync: url.searchParams.get("sync") === "initial",
    status: rawStatus === "connected" ? "connected" : "error",
  };

  for (const key of [
    "integration",
    "status",
    "reason",
    "connectionId",
    "sync",
  ]) {
    url.searchParams.delete(key);
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return result;
}

function syncSummary(payload: SyncPayload, initial: boolean): string {
  const sync = payload.synced?.[0];

  if (!sync) {
    const failure = payload.failed?.[0];
    throw new GoogleUiError(
      failure?.code || "google_sync_failed",
      "Google Calendar sync failed",
    );
  }

  const prefix = initial ? "Первый импорт завершён." : "Календарь обновлён.";
  const categorized = sync.categorized > 0
    ? `, распределено по сферам: ${sync.categorized}`
    : "";
  return `${prefix} Получено: ${sync.imported}${categorized}, удалено: ${sync.deleted}, пропущено: ${sync.skipped}.`;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof GoogleUiError) {
    return messageForCode(cause.code, cause.message);
  }

  return cause instanceof Error
    ? cause.message
    : "Не удалось выполнить операцию с Google Calendar.";
}

function messageForCode(code: string, fallback?: string): string {
  const messages: Record<string, string> = {
    AUTHENTICATION_REQUIRED: "Сессия завершилась. Войдите снова.",
    GOOGLE_DISCONNECT_REQUIRED:
      "Сначала отключите все Google-аккаунты, затем измените OAuth-данные.",
    access_denied: "Вы отменили предоставление доступа Google Calendar.",
    authentication_required: "Сессия завершилась. Войдите снова.",
    google_access_token_rejected:
      "Google отклонил доступ. Переподключите аккаунт.",
    google_authorization_expired:
      "Доступ Google истёк или был отозван. Переподключите аккаунт.",
    google_authorization_failed:
      "Google не завершил авторизацию. Попробуйте подключить аккаунт снова.",
    google_calendar_forbidden:
      "Google запретил чтение календаря. Проверьте Calendar API и разрешения.",
    google_configuration_changed:
      "OAuth-настройки изменились во время подключения. Начните подключение заново.",
    google_configuration_unreadable:
      "Сохранённые OAuth-данные повреждены. Замените их.",
    google_encryption_not_configured:
      "Серверное шифрование Google Calendar не настроено.",
    google_not_configured:
      "Сначала сохраните Client ID и Client Secret для Google Calendar.",
    google_rate_limited:
      "Google временно ограничил запросы. Повторите обновление позже.",
    google_reconnect_required: "Переподключите Google-аккаунт.",
    google_refresh_token_missing:
      "Google не выдал длительный доступ. Подключите аккаунт заново и подтвердите разрешение.",
    google_required_scopes_missing:
      "Разрешение на чтение календаря предоставлено не полностью.",
    google_sync_failed: "Не удалось импортировать события Google Calendar.",
    google_token_decryption_failed:
      "Сохранённый доступ больше нельзя прочитать. Переподключите аккаунт.",
    google_unavailable: "Google временно недоступен. Попробуйте позже.",
    internal_error: "Не удалось завершить подключение Google Calendar.",
    invalid_oauth_state:
      "Попытка подключения устарела или уже недействительна. Начните заново.",
  };

  return messages[code] || fallback || "Операция Google Calendar не выполнена.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}
