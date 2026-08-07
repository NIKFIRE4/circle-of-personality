import {
  apiErrorResponse,
  ApiError,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { CalendarFeedError } from "@/lib/calendar-feed";
import { syncCalendarFeedConnection } from "@/lib/calendar-feed-sync";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

type FeedSyncRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: FeedSyncRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await getCurrentUser();

    if (!user) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required",
      );
    }

    const { id } = await context.params;

    if (!id || id.length > 191) {
      throw new ApiError(422, "INVALID_CONNECTION_ID", "Invalid connection ID");
    }

    const sync = await syncCalendarFeedConnection({
      connectionId: id,
      metadata: getRequestMetadata(request),
      userId: user.id,
      userTimeZone: user.timeZone,
    });

    return jsonResponse({ sync });
  } catch (error) {
    if (error instanceof CalendarFeedError) {
      return apiErrorResponse(error.status, error.code, error.message);
    }

    return handleRouteError(error);
  }
}
