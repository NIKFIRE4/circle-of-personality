import {
  ApiError,
  apiErrorResponse,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { safelyClassifyImportedCalendarMonth } from "@/lib/calendar-event-classifier";
import { prisma } from "@/lib/db";
import {
  getUsableGoogleAccessToken,
  GoogleCalendarError,
  normalizeGoogleCalendarEvent,
  pullGoogleCalendarEvents,
  resolveGoogleOAuthConfiguration,
  type GoogleOAuthConfiguration,
  type RefreshedGoogleAuthorization,
  type StoredGoogleAuthorization,
} from "@/lib/google-calendar";
import { getRequestMetadata, type RequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

const DATABASE_BATCH_SIZE = 100;

type SyncConnection = {
  accessTokenEncrypted: string | null;
  calendarId: string | null;
  id: string;
  refreshTokenEncrypted: string | null;
  scopes: string[];
  syncToken: string | null;
  tokenExpiresAt: Date | null;
};

type SuccessfulSync = {
  analyzed: number;
  categorized: number;
  classificationMode: "ai" | "local" | "mixed" | "skipped";
  connectionId: string;
  deleted: number;
  imported: number;
  mode: "full" | "incremental";
  resetFromExpiredToken: boolean;
  skipped: number;
};

type FailedSync = {
  code: string;
  connectionId: string;
  message: string;
  status: number;
};

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

    const configuration = await resolveGoogleOAuthConfiguration(
      user.id,
      new URL(request.url).origin,
    );

    const requestedConnectionId = new URL(request.url).searchParams.get(
      "connectionId",
    );
    const connections = await prisma.calendarConnection.findMany({
      where: {
        provider: "GOOGLE",
        userId: user.id,
        ...(requestedConnectionId ? { id: requestedConnectionId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        accessTokenEncrypted: true,
        calendarId: true,
        id: true,
        refreshTokenEncrypted: true,
        scopes: true,
        syncToken: true,
        tokenExpiresAt: true,
      },
    });

    if (requestedConnectionId && connections.length === 0) {
      throw new ApiError(
        404,
        "GOOGLE_CONNECTION_NOT_FOUND",
        "Google Calendar connection was not found",
      );
    }

    if (connections.length === 0) {
      throw new ApiError(
        409,
        "GOOGLE_NOT_CONNECTED",
        "Connect Google Calendar before syncing",
      );
    }

    const metadata = getRequestMetadata(request);
    const synced: SuccessfulSync[] = [];
    const failed: FailedSync[] = [];

    for (const connection of connections) {
      try {
        synced.push(
          await syncConnection(
            user.id,
            user.timeZone,
            connection,
            configuration,
            metadata,
          ),
        );
      } catch (error) {
        if (error instanceof GoogleCalendarError) {
          if (requiresGoogleReconnect(error.code)) {
            await prisma.calendarConnection.updateMany({
              where: { id: connection.id, userId: user.id },
              data: {
                accessTokenEncrypted: null,
                refreshTokenEncrypted: null,
                syncToken: null,
                tokenExpiresAt: null,
              },
            });
          }

          failed.push({
            code: error.code,
            connectionId: connection.id,
            message: error.message,
            status: error.status,
          });
          continue;
        }

        throw error;
      }
    }

    if (requestedConnectionId && failed.length === 1 && synced.length === 0) {
      const failure = failed[0];
      return apiErrorResponse(
        failure.status,
        failure.code,
        failure.message,
        { connectionId: failure.connectionId },
      );
    }

    const status = failed.length > 0 ? 207 : 200;
    return jsonResponse(
      {
        failed: failed.map(({ code, connectionId }) => ({
          code,
          connectionId,
        })),
        synced,
        syncedAt: new Date(),
      },
      { status },
    );
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      return apiErrorResponse(error.status, error.code, error.message);
    }

    return handleRouteError(error);
  }
}

async function syncConnection(
  userId: string,
  userTimeZone: string,
  connection: SyncConnection,
  configuration: GoogleOAuthConfiguration,
  requestMetadata: RequestMetadata,
): Promise<SuccessfulSync> {
  const calendarId = connection.calendarId;

  if (!calendarId) {
    throw new GoogleCalendarError(
      "google_calendar_missing",
      "The connection has no Google calendar selected",
      422,
    );
  }

  let authorization: StoredGoogleAuthorization = {
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    scopes: connection.scopes,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
  const persistRefresh = async (
    refreshed: RefreshedGoogleAuthorization,
  ): Promise<void> => {
    const updated = await prisma.calendarConnection.updateMany({
      where: { id: connection.id, userId },
      data: refreshed,
    });

    if (updated.count !== 1) {
      throw new GoogleCalendarError(
        "google_connection_changed",
        "Google Calendar connection changed during token refresh",
        409,
      );
    }

    authorization = refreshed;
  };

  let accessToken = await getUsableGoogleAccessToken(
    authorization,
    configuration,
    persistRefresh,
  );
  let remote;

  try {
    remote = await pullGoogleCalendarEvents(
      accessToken,
      calendarId,
      connection.syncToken,
    );
  } catch (error) {
    if (
      !(error instanceof GoogleCalendarError) ||
      error.code !== "google_access_token_rejected"
    ) {
      throw error;
    }

    accessToken = await getUsableGoogleAccessToken(
      authorization,
      configuration,
      persistRefresh,
      true,
    );
    remote = await pullGoogleCalendarEvents(
      accessToken,
      calendarId,
      connection.syncToken,
    );
  }

  const normalizedByExternalId = new Map(
    remote.events
      .map((event) => normalizeGoogleCalendarEvent(event, userTimeZone))
      .filter((event) => event !== null)
      .map((event) => [event.externalId, event] as const),
  );
  const cancelledExternalIds: string[] = [];
  const activeEvents = [];

  for (const event of normalizedByExternalId.values()) {
    if (event.status === "CANCELLED") {
      cancelledExternalIds.push(event.externalId);
    } else {
      activeEvents.push(event);
    }
  }

  const staleEventIds = remote.initialWindow
    ? await findStaleEventIds(
        connection.id,
        new Set(activeEvents.map((event) => event.externalId)),
      )
    : [];
  let deleted = 0;

  for (const ids of chunk([...new Set(cancelledExternalIds)], DATABASE_BATCH_SIZE)) {
    const result = await prisma.event.deleteMany({
      where: {
        calendarConnectionId: connection.id,
        externalId: { in: ids },
        userId,
      },
    });
    deleted += result.count;
  }

  for (const ids of chunk(staleEventIds, DATABASE_BATCH_SIZE)) {
    const result = await prisma.event.deleteMany({
      where: { id: { in: ids }, userId },
    });
    deleted += result.count;
  }

  for (const events of chunk(activeEvents, DATABASE_BATCH_SIZE)) {
    await prisma.$transaction(
      events.map((event) =>
        prisma.event.upsert({
          where: {
            calendarConnectionId_externalId: {
              calendarConnectionId: connection.id,
              externalId: event.externalId,
            },
          },
          create: {
            allDay: event.allDay,
            calendarConnectionId: connection.id,
            description: event.description,
            endAt: event.endAt,
            externalId: event.externalId,
            location: event.location,
            recurrenceRule: event.recurrenceRule,
            source: "GOOGLE",
            startAt: event.startAt,
            status: "PLANNED",
            title: event.title,
            userId,
          },
          update: {
            allDay: event.allDay,
            description: event.description,
            endAt: event.endAt,
            location: event.location,
            recurrenceRule: event.recurrenceRule,
            startAt: event.startAt,
            title: event.title,
          },
        }),
      ),
    );
  }

  const classification = await safelyClassifyImportedCalendarMonth({
    connectionId: connection.id,
    metadata: requestMetadata,
    userId,
    userTimeZone,
  });

  const finishedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.calendarConnection.updateMany({
      where: { id: connection.id, userId },
      data: {
        lastSyncedAt: finishedAt,
        syncToken: remote.nextSyncToken,
      },
    });

    if (updated.count !== 1) {
      throw new ApiError(
        409,
        "GOOGLE_CONNECTION_CHANGED",
        "Google Calendar connection changed during sync",
      );
    }

    await tx.auditLog.create({
      data: {
        action: "GOOGLE_CALENDAR_SYNCED",
        actorUserId: userId,
        entityId: connection.id,
        entityType: "CalendarConnection",
        ipHash: requestMetadata.ipHash,
        metadata: {
          analyzed: classification.analyzed,
          categorized: classification.categorized,
          classificationMode: classification.mode,
          deleted,
          imported: activeEvents.length,
          mode: remote.fullSync ? "full" : "incremental",
          resetFromExpiredToken: remote.resetFromExpiredToken,
          skipped: remote.events.length - normalizedByExternalId.size,
        },
        userAgent: requestMetadata.userAgent,
      },
    });
  });

  return {
    analyzed: classification.analyzed,
    categorized: classification.categorized,
    classificationMode: classification.mode,
    connectionId: connection.id,
    deleted,
    imported: activeEvents.length,
    mode: remote.fullSync ? "full" : "incremental",
    resetFromExpiredToken: remote.resetFromExpiredToken,
    skipped: remote.events.length - normalizedByExternalId.size,
  };
}

function requiresGoogleReconnect(code: string): boolean {
  return new Set([
    "google_authorization_expired",
    "google_reconnect_required",
    "google_token_decryption_failed",
  ]).has(code);
}

async function findStaleEventIds(
  connectionId: string,
  activeExternalIds: Set<string>,
): Promise<string[]> {
  const localEvents = await prisma.event.findMany({
    where: {
      calendarConnectionId: connectionId,
      source: "GOOGLE",
    },
    select: { externalId: true, id: true },
  });

  return localEvents
    .filter(
      (event) =>
        !event.externalId || !activeExternalIds.has(event.externalId),
    )
    .map((event) => event.id);
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
