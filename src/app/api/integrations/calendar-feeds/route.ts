import { z } from "zod";

import {
  apiErrorResponse,
  ApiError,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
  parseJson,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { CalendarFeedError } from "@/lib/calendar-feed";
import {
  createCalendarFeedConnection,
  listCalendarFeedConnections,
} from "@/lib/calendar-feed-sync";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

const createFeedSchema = z.object({
  url: z.string().trim().min(1).max(4_096),
}).strict();

export async function GET() {
  try {
    const user = await requireApiUser();
    const connections = await listCalendarFeedConnections(user.id);
    return jsonResponse({ connections });
  } catch (error) {
    return calendarFeedRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, createFeedSchema);
    const result = await createCalendarFeedConnection({
      metadata: getRequestMetadata(request),
      url: input.url,
      userId: user.id,
      userTimeZone: user.timeZone,
    });

    return jsonResponse(result, { status: 201 });
  } catch (error) {
    return calendarFeedRouteError(error);
  }
}

async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication is required",
    );
  }

  return user;
}

function calendarFeedRouteError(error: unknown) {
  if (error instanceof CalendarFeedError) {
    return apiErrorResponse(error.status, error.code, error.message);
  }

  return handleRouteError(error);
}
