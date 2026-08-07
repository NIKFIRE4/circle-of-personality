import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toZonedTime } from "date-fns-tz";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));

import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  decryptGoogleClientSecret,
  decryptGoogleToken,
  encryptGoogleClientSecret,
  encryptGoogleToken,
  GoogleCalendarError,
  GOOGLE_CALENDAR_SCOPES,
  maskGoogleClientId,
  normalizeGoogleCalendarEvent,
  verifyGoogleOAuthState,
  type GoogleOAuthConfiguration,
} from "./google-calendar";

const originalEncryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

describe("Google Calendar secret encryption", () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = `base64:${Buffer.alloc(
      32,
      7,
    ).toString("base64")}`;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it("round-trips a per-user client secret without storing plaintext", () => {
    const encrypted = encryptGoogleClientSecret("oauth-secret-value", "user-a");

    expect(encrypted).not.toContain("oauth-secret-value");
    expect(decryptGoogleClientSecret(encrypted, "user-a")).toBe(
      "oauth-secret-value",
    );
  });

  it("binds client-secret ciphertext to its user", () => {
    const encrypted = encryptGoogleClientSecret("oauth-secret-value", "user-a");

    expect(() => decryptGoogleClientSecret(encrypted, "user-b")).toThrowError(
      expect.objectContaining({ code: "google_configuration_unreadable" }),
    );
  });

  it("uses a separate AAD purpose for OAuth tokens", () => {
    const encryptedToken = encryptGoogleToken("refresh-token");
    const encryptedSecret = encryptGoogleClientSecret("client-secret", "user-a");

    expect(decryptGoogleToken(encryptedToken)).toBe("refresh-token");
    expect(() =>
      decryptGoogleClientSecret(encryptedToken, "user-a"),
    ).toThrowError(
      expect.objectContaining({ code: "google_configuration_unreadable" }),
    );
    expect(() => decryptGoogleToken(encryptedSecret)).toThrowError(
      expect.objectContaining({ code: "google_token_decryption_failed" }),
    );
  });

  it("rejects arbitrary passphrases as the server master key", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "development-passphrase";

    expect(() => encryptGoogleToken("token")).toThrowError(
      expect.objectContaining({
        code: "google_encryption_not_configured",
        status: 503,
      }),
    );
  });
});

describe("Google Calendar OAuth helpers", () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = `hex:${Buffer.alloc(32, 9).toString(
      "hex",
    )}`;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it("binds OAuth state to the user and configuration fingerprint", () => {
    const created = createGoogleOAuthState("user-a", "config-a");

    expect(
      verifyGoogleOAuthState(
        created.state,
        created.cookieValue,
        "user-a",
        "config-a",
      ),
    ).toBe("valid");
    expect(
      verifyGoogleOAuthState(
        created.state,
        created.cookieValue,
        "user-a",
        "config-b",
      ),
    ).toBe("config_changed");
    expect(
      verifyGoogleOAuthState(
        created.state,
        created.cookieValue,
        "user-b",
        "config-a",
      ),
    ).toBe("invalid");
  });

  it("rejects a mismatched state value", () => {
    const created = createGoogleOAuthState("user-a", "config-a");

    expect(
      verifyGoogleOAuthState(
        "different-state",
        created.cookieValue,
        "user-a",
        "config-a",
      ),
    ).toBe("invalid");
  });

  it("requests only the read-only Calendar scopes", () => {
    const configuration: GoogleOAuthConfiguration = {
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "secret",
      fingerprint: "config-a",
      redirectUri:
        "http://localhost:3000/api/integrations/google/callback",
      source: "user",
    };
    const url = buildGoogleAuthorizationUrl("state", configuration);
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toEqual([...GOOGLE_CALENDAR_SCOPES]);
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
  });

  it("masks client IDs in public status payloads", () => {
    const masked = maskGoogleClientId(
      "1234567890-example.apps.googleusercontent.com",
    );

    expect(masked).toContain("…");
    expect(masked).not.toContain("7890-example");
  });
});

describe("Google Calendar all-day dates", () => {
  it("preserves the semantic date in a negative-offset IANA zone", () => {
    const timeZone = "America/New_York";
    const normalized = normalizeGoogleCalendarEvent(
      {
        end: { date: "2026-08-07" },
        id: "all-day-event",
        start: { date: "2026-08-06" },
        status: "confirmed",
        summary: "All day",
      },
      timeZone,
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.allDay).toBe(true);
    expect(normalized?.startAt.toISOString()).toBe(
      "2026-08-06T04:00:00.000Z",
    );

    const displayedStart = toZonedTime(normalized!.startAt, timeZone);
    const displayedEnd = toZonedTime(normalized!.endAt, timeZone);

    expect([
      displayedStart.getFullYear(),
      displayedStart.getMonth() + 1,
      displayedStart.getDate(),
    ]).toEqual([2026, 8, 6]);
    expect([
      displayedEnd.getFullYear(),
      displayedEnd.getMonth() + 1,
      displayedEnd.getDate(),
    ]).toEqual([2026, 8, 7]);
  });
});

describe("GoogleCalendarError", () => {
  it("keeps stable machine-readable fields", () => {
    const error = new GoogleCalendarError("google_test", "Safe message", 409);

    expect(error).toMatchObject({
      code: "google_test",
      message: "Safe message",
      status: 409,
    });
  });
});
