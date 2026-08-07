import {
  ApiError,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { syncStaleCalendarFeedConnections } from "@/lib/calendar-feed-sync";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

    const result = await syncStaleCalendarFeedConnections({
      metadata: getRequestMetadata(request),
      userId: user.id,
      userTimeZone: user.timeZone,
    });

    return jsonResponse(result, { status: result.failed.length ? 207 : 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
