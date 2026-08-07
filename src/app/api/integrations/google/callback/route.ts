import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  encryptGoogleToken,
  exchangeGoogleAuthorizationCode,
  getGooglePrimaryCalendar,
  GoogleCalendarError,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE_OPTIONS,
  hasRequiredGoogleCalendarScopes,
  resolveGoogleOAuthConfiguration,
  revokeGoogleToken,
  verifyGoogleOAuthState,
} from "@/lib/google-calendar";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

type CallbackStatus = "connected" | "error";

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  let accessTokenToRevoke: string | null = null;
  let connectionSaved = false;

  try {
    const user = await getCurrentUser();

    if (!user) {
      return callbackRedirect(request, "error", "authentication_required");
    }

    const receivedState = request.nextUrl.searchParams.get("state");
    const configuration = await resolveGoogleOAuthConfiguration(
      user.id,
      request.nextUrl.origin,
    );
    const stateVerification = verifyGoogleOAuthState(
      receivedState,
      stateCookie,
      user.id,
      configuration.fingerprint,
    );

    if (stateVerification === "config_changed") {
      return callbackRedirect(
        request,
        "error",
        "google_configuration_changed",
      );
    }

    if (stateVerification !== "valid") {
      return callbackRedirect(request, "error", "invalid_oauth_state");
    }

    const providerError = request.nextUrl.searchParams.get("error");

    if (providerError) {
      return callbackRedirect(
        request,
        "error",
        providerError === "access_denied"
          ? "access_denied"
          : "google_authorization_failed",
      );
    }

    const code = request.nextUrl.searchParams.get("code");

    if (!code) {
      return callbackRedirect(request, "error", "authorization_code_missing");
    }

    const tokens = await exchangeGoogleAuthorizationCode(code, configuration);
    accessTokenToRevoke = tokens.accessToken;

    if (!hasRequiredGoogleCalendarScopes(tokens.scopes)) {
      throw new GoogleCalendarError(
        "google_required_scopes_missing",
        "Google Calendar permissions were not fully granted",
        403,
      );
    }

    const primaryCalendar = await getGooglePrimaryCalendar(tokens.accessToken);
    const externalAccountId = primaryCalendar.id;
    const existingConnection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider_externalAccountId: {
          externalAccountId,
          provider: "GOOGLE",
          userId: user.id,
        },
      },
      select: {
        id: true,
        refreshTokenEncrypted: true,
      },
    });
    const refreshTokenEncrypted = tokens.refreshToken
      ? encryptGoogleToken(tokens.refreshToken)
      : existingConnection?.refreshTokenEncrypted;

    if (!refreshTokenEncrypted) {
      throw new GoogleCalendarError(
        "google_refresh_token_missing",
        "Google did not grant offline access; reconnect and approve access",
        422,
      );
    }

    const grantedScopes = tokens.scopes;
    const accountEmail = looksLikeEmail(primaryCalendar.id)
      ? primaryCalendar.id.toLowerCase()
      : null;
    const metadata = getRequestMetadata(request);

    const connection = await prisma.$transaction(async (tx) => {
      const savedConnection = await tx.calendarConnection.upsert({
        where: {
          userId_provider_externalAccountId: {
            externalAccountId,
            provider: "GOOGLE",
            userId: user.id,
          },
        },
        create: {
          accessTokenEncrypted: encryptGoogleToken(tokens.accessToken),
          accountEmail,
          calendarId: primaryCalendar.id,
          externalAccountId,
          provider: "GOOGLE",
          refreshTokenEncrypted,
          scopes: grantedScopes,
          tokenExpiresAt: tokens.expiresAt,
          userId: user.id,
        },
        update: {
          accessTokenEncrypted: encryptGoogleToken(tokens.accessToken),
          accountEmail,
          calendarId: primaryCalendar.id,
          lastSyncedAt: null,
          refreshTokenEncrypted,
          scopes: grantedScopes,
          syncToken: null,
          tokenExpiresAt: tokens.expiresAt,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          action: existingConnection
            ? "GOOGLE_CALENDAR_RECONNECTED"
            : "GOOGLE_CALENDAR_CONNECTED",
          actorUserId: user.id,
          entityId: savedConnection.id,
          entityType: "CalendarConnection",
          ipHash: metadata.ipHash,
          metadata: {
            calendarSummary: primaryCalendar.summary ?? null,
            scopes: grantedScopes,
            timeZone: primaryCalendar.timeZone ?? null,
          },
          userAgent: metadata.userAgent,
        },
      });

      return savedConnection;
    });
    connectionSaved = true;

    return callbackRedirect(
      request,
      "connected",
      undefined,
      connection.id,
      true,
    );
  } catch (error) {
    if (accessTokenToRevoke && !connectionSaved) {
      await revokeGoogleToken(accessTokenToRevoke).catch(() => false);
    }

    if (error instanceof GoogleCalendarError) {
      return callbackRedirect(request, "error", error.code);
    }

    console.error("Google Calendar OAuth callback failed", error);
    return callbackRedirect(request, "error", "internal_error");
  }
}

function callbackRedirect(
  request: NextRequest,
  status: CallbackStatus,
  reason?: string,
  connectionId?: string,
  requestInitialSync = false,
): NextResponse {
  const appUrl = process.env.APP_URL?.trim();
  let target: URL;

  try {
    target = new URL("/settings", appUrl || request.nextUrl.origin);
  } catch {
    target = new URL("/settings", request.nextUrl.origin);
  }

  target.searchParams.set("integration", "google");
  target.searchParams.set("status", status);

  if (reason) {
    target.searchParams.set("reason", reason);
  }

  if (connectionId) {
    target.searchParams.set("connectionId", connectionId);
  }

  if (requestInitialSync) {
    target.searchParams.set("sync", "initial");
  }

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    ...GOOGLE_OAUTH_STATE_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}

function looksLikeEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
