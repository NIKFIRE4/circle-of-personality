import {
  ApiError,
  apiErrorResponse,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  decryptGoogleToken,
  GoogleCalendarError,
  revokeGoogleToken,
} from "@/lib/google-calendar";
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

    const requestedConnectionId = new URL(request.url).searchParams.get(
      "connectionId",
    );

    if (!requestedConnectionId) {
      throw new ApiError(
        422,
        "GOOGLE_CONNECTION_ID_REQUIRED",
        "Choose the Google Calendar connection to disconnect",
      );
    }

    const connection = await prisma.calendarConnection.findFirst({
      where: {
        id: requestedConnectionId,
        provider: "GOOGLE",
        userId: user.id,
      },
      select: {
        accessTokenEncrypted: true,
        id: true,
        refreshTokenEncrypted: true,
      },
    });

    if (!connection) {
      throw new ApiError(
        404,
        "GOOGLE_CONNECTION_NOT_FOUND",
        "Google Calendar connection was not found",
      );
    }

    const revokedAtGoogle = await revokeConnectionToken(connection);
    const metadata = getRequestMetadata(request);

    const deletedEvents = await prisma.$transaction(async (tx) => {
      const events = await tx.event.deleteMany({
        where: {
          calendarConnectionId: connection.id,
          source: "GOOGLE",
          userId: user.id,
        },
      });

      const deletedConnection = await tx.calendarConnection.deleteMany({
        where: { id: connection.id, userId: user.id },
      });

      if (deletedConnection.count !== 1) {
        throw new ApiError(
          409,
          "GOOGLE_CONNECTION_CHANGED",
          "Google Calendar connection changed during disconnect",
        );
      }

      await tx.auditLog.create({
        data: {
          action: "GOOGLE_CALENDAR_DISCONNECTED",
          actorUserId: user.id,
          entityId: connection.id,
          entityType: "CalendarConnection",
          ipHash: metadata.ipHash,
          metadata: {
            deletedEventsTotal: events.count,
            revokedAtGoogle,
          },
          userAgent: metadata.userAgent,
        },
      });

      return events.count;
    });

    return jsonResponse({
      disconnected: [connection.id],
      removedEvents: deletedEvents,
      revocations: [
        {
          connectionId: connection.id,
          revokedAtGoogle,
        },
      ],
    });
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      return apiErrorResponse(error.status, error.code, error.message);
    }

    return handleRouteError(error);
  }
}

async function revokeConnectionToken(connection: {
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
}): Promise<boolean> {
  const encryptedToken =
    connection.refreshTokenEncrypted ?? connection.accessTokenEncrypted;

  if (!encryptedToken) {
    return false;
  }

  try {
    return await revokeGoogleToken(decryptGoogleToken(encryptedToken));
  } catch {
    // Local disconnect must remain available if Google is down, the grant has
    // already expired, or an old encryption key is no longer available.
    return false;
  }
}
