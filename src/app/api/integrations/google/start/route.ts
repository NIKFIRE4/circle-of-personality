import { NextResponse } from "next/server";

import { ApiError, handleRouteError } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  GoogleCalendarError,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE_OPTIONS,
  resolveGoogleOAuthConfiguration,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required",
      );
    }

    const requestUrl = new URL(request.url);
    const configuration = await resolveGoogleOAuthConfiguration(
      user.id,
      requestUrl.origin,
    );
    const { cookieValue, state } = createGoogleOAuthState(
      user.id,
      configuration.fingerprint,
    );
    const authorizationUrl = buildGoogleAuthorizationUrl(
      state,
      configuration,
    );
    const response = NextResponse.redirect(authorizationUrl);

    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.cookies.set(
      GOOGLE_OAUTH_STATE_COOKIE,
      cookieValue,
      GOOGLE_OAUTH_STATE_COOKIE_OPTIONS,
    );

    return response;
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      return configurationErrorRedirect(request, error.code);
    }

    return handleRouteError(error);
  }
}

function configurationErrorRedirect(request: Request, reason: string) {
  const requestUrl = new URL(request.url);
  let target: URL;

  try {
    target = new URL("/settings", process.env.APP_URL || requestUrl.origin);
  } catch {
    target = new URL("/settings", requestUrl.origin);
  }

  target.searchParams.set("integration", "google");
  target.searchParams.set("status", "error");
  target.searchParams.set("reason", reason);

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    ...GOOGLE_OAUTH_STATE_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
