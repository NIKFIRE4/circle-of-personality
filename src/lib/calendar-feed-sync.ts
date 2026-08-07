import { Prisma } from "@prisma/client";

import {
  calendarFeedExternalAccountId,
  CalendarFeedError,
  type CalendarFeedProvider,
  decryptCalendarFeedUrl,
  downloadCalendarFeed,
  encryptCalendarFeedUrl,
  normalizeCalendarFeedUrl,
  type NormalizedCalendarFeedEvent,
  parseCalendarFeed,
} from "@/lib/calendar-feed";
import {
  calendarClassificationUtcRange,
  safelyClassifyImportedCalendarMonth,
  type CalendarEventClassificationMode,
} from "@/lib/calendar-event-classifier";
import { prisma } from "@/lib/db";
import type { RequestMetadata } from "@/lib/security";

const DATABASE_BATCH_SIZE = 100;
const AUTOMATIC_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
const SNAPSHOT_REEXPANSION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type CalendarFeedSyncResult = {
  analyzed: number;
  categorized: number;
  classificationMode: CalendarEventClassificationMode;
  connectionId: string;
  deleted: number;
  eventCount: number;
  imported: number;
  skipped: number;
  unchanged: boolean;
};

export type CalendarFeedConnectionDto = {
  connectedAt: Date;
  displayName: string;
  eventCount: number;
  id: string;
  lastSyncedAt: Date | null;
  provider: CalendarFeedProvider;
};

type FeedConnectionRecord = {
  displayName: string | null;
  feedContentHash: string | null;
  feedEtag: string | null;
  feedLastModified: string | null;
  feedSnapshotAt: Date | null;
  feedUrlEncrypted: string;
  id: string;
  provider: CalendarFeedProvider;
};

export async function listCalendarFeedConnections(
  userId: string,
): Promise<CalendarFeedConnectionDto[]> {
  const connections = await prisma.calendarConnection.findMany({
    where: { feedUrlEncrypted: { not: null }, userId },
    orderBy: { createdAt: "asc" },
    select: {
      _count: { select: { events: true } },
      createdAt: true,
      displayName: true,
      id: true,
      lastSyncedAt: true,
      provider: true,
    },
  });

  return connections.flatMap((connection) => {
    if (connection.provider !== "GOOGLE" && connection.provider !== "APPLE") {
      return [];
    }

    return [{
      connectedAt: connection.createdAt,
      displayName:
        connection.displayName ??
        (connection.provider === "APPLE" ? "Календарь Apple" : "Календарь Google"),
      eventCount: connection._count.events,
      id: connection.id,
      lastSyncedAt: connection.lastSyncedAt,
      provider: connection.provider,
    }];
  });
}

export async function createCalendarFeedConnection(input: {
  metadata: RequestMetadata;
  url: string;
  userId: string;
  userTimeZone: string;
}): Promise<{
  connection: CalendarFeedConnectionDto;
  sync: CalendarFeedSyncResult;
}> {
  const normalized = normalizeCalendarFeedUrl(input.url);
  const externalAccountId = calendarFeedExternalAccountId(normalized.url);
  const encryptedUrl = encryptCalendarFeedUrl(normalized.url);
  const duplicate = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider_externalAccountId: {
        externalAccountId,
        provider: normalized.provider,
        userId: input.userId,
      },
    },
    select: { id: true },
  });

  if (duplicate) throw duplicateFeedError();

  const download = await downloadCalendarFeed(normalized.url, normalized.provider);

  if (download.notModified) {
    throw new CalendarFeedError(
      "calendar_feed_invalid_response",
      "Календарь не вернул данные для первого импорта",
      502,
    );
  }

  const parsed = await parseCalendarFeed(
    download.body,
    normalized.provider,
    input.userTimeZone,
  );
  const syncedAt = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const connection = await tx.calendarConnection.create({
        data: {
          displayName: parsed.displayName,
          externalAccountId,
          feedContentHash: download.contentHash,
          feedEtag: download.etag,
          feedLastModified: download.lastModified,
          feedSnapshotAt: syncedAt,
          feedUrlEncrypted: encryptedUrl,
          lastSyncedAt: syncedAt,
          provider: normalized.provider,
          userId: input.userId,
        },
        select: { createdAt: true, id: true },
      });

      await upsertFeedEvents(
        tx,
        input.userId,
        connection.id,
        normalized.provider,
        parsed.events,
      );

      await tx.auditLog.create({
        data: {
          action: "CALENDAR_FEED_CONNECTED",
          actorUserId: input.userId,
          entityId: connection.id,
          entityType: "CalendarConnection",
          ipHash: input.metadata.ipHash,
          metadata: {
            imported: parsed.events.length,
            provider: normalized.provider,
            skipped: parsed.skipped,
          },
          userAgent: input.metadata.userAgent,
        },
      });

      return {
        connection: {
          connectedAt: connection.createdAt,
          displayName: parsed.displayName,
          eventCount: parsed.events.length,
          id: connection.id,
          lastSyncedAt: syncedAt,
          provider: normalized.provider,
        },
        sync: {
          connectionId: connection.id,
          deleted: 0,
          eventCount: parsed.events.length,
          imported: parsed.events.length,
          skipped: parsed.skipped,
          unchanged: false,
        },
      };
    }, transactionOptions());

    return {
      connection: result.connection,
      sync: await withCalendarClassification(result.sync, input),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw duplicateFeedError();
    }

    throw error;
  }
}

export async function syncCalendarFeedConnection(input: {
  connectionId: string;
  metadata: RequestMetadata;
  userId: string;
  userTimeZone: string;
}): Promise<CalendarFeedSyncResult> {
  const connection = await findOwnedFeedConnection(
    input.connectionId,
    input.userId,
  );
  const url = decryptCalendarFeedUrl(connection.feedUrlEncrypted);
  const normalized = normalizeCalendarFeedUrl(url, connection.provider);
  const needsSnapshotReexpansion =
    !connection.feedSnapshotAt ||
    syncedAtDistance(connection.feedSnapshotAt) >= SNAPSHOT_REEXPANSION_INTERVAL_MS;
  const download = await downloadCalendarFeed(normalized.url, normalized.provider, {
    etag: needsSnapshotReexpansion ? null : connection.feedEtag,
    lastModified: needsSnapshotReexpansion ? null : connection.feedLastModified,
  });
  const syncedAt = new Date();

  if (download.notModified) {
    const eventCount = await markFeedUnchanged({
      connection,
      etag: download.etag,
      lastModified: download.lastModified,
      metadata: input.metadata,
      syncedAt,
      userId: input.userId,
    });

    return withCalendarClassification({
      connectionId: connection.id,
      deleted: 0,
      eventCount,
      imported: 0,
      skipped: 0,
      unchanged: true,
    }, input);
  }

  if (
    download.contentHash === connection.feedContentHash &&
    !needsSnapshotReexpansion
  ) {
    const eventCount = await markFeedUnchanged({
      connection,
      etag: download.etag,
      lastModified: download.lastModified,
      metadata: input.metadata,
      syncedAt,
      userId: input.userId,
    });

    return withCalendarClassification({
      connectionId: connection.id,
      deleted: 0,
      eventCount,
      imported: 0,
      skipped: 0,
      unchanged: true,
    }, input);
  }

  const parsed = await parseCalendarFeed(
    download.body,
    normalized.provider,
    input.userTimeZone,
    syncedAt,
  );

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await replaceFeedSnapshot(
      tx,
      input.userId,
      connection.id,
      normalized.provider,
      parsed.events,
    );
    const updated = await tx.calendarConnection.updateMany({
      where: {
        feedUrlEncrypted: { not: null },
        id: connection.id,
        userId: input.userId,
      },
      data: {
        displayName: parsed.displayName,
        feedContentHash: download.contentHash,
        feedEtag: download.etag,
        feedLastModified: download.lastModified,
        feedSnapshotAt: syncedAt,
        lastSyncedAt: syncedAt,
      },
    });

    if (updated.count !== 1) throw changedFeedError();

    await tx.auditLog.create({
      data: {
        action: "CALENDAR_FEED_SYNCED",
        actorUserId: input.userId,
        entityId: connection.id,
        entityType: "CalendarConnection",
        ipHash: input.metadata.ipHash,
        metadata: {
          deleted,
          imported: parsed.events.length,
          provider: normalized.provider,
          skipped: parsed.skipped,
          unchanged: false,
        },
        userAgent: input.metadata.userAgent,
      },
    });

    return {
      connectionId: connection.id,
      deleted,
      eventCount: parsed.events.length,
      imported: parsed.events.length,
      skipped: parsed.skipped,
      unchanged: false,
    };
  }, transactionOptions());

  return withCalendarClassification(result, input);
}

export async function syncStaleCalendarFeedConnections(input: {
  metadata: RequestMetadata;
  userId: string;
  userTimeZone: string;
}): Promise<{
  failed: Array<{ code: string; connectionId: string }>;
  synced: CalendarFeedSyncResult[];
}> {
  const staleBefore = new Date(Date.now() - AUTOMATIC_SYNC_INTERVAL_MS);
  const connections = await prisma.calendarConnection.findMany({
    where: {
      feedUrlEncrypted: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
      provider: { in: ["GOOGLE", "APPLE"] },
      userId: input.userId,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const failed: Array<{ code: string; connectionId: string }> = [];
  const synced: CalendarFeedSyncResult[] = [];

  for (const connection of connections) {
    try {
      synced.push(await syncCalendarFeedConnection({
        connectionId: connection.id,
        metadata: input.metadata,
        userId: input.userId,
        userTimeZone: input.userTimeZone,
      }));
    } catch (error) {
      failed.push({
        code:
          error instanceof CalendarFeedError
            ? error.code
            : "calendar_feed_sync_failed",
        connectionId: connection.id,
      });
    }
  }

  return { failed, synced };
}

export async function disconnectCalendarFeedConnection(input: {
  connectionId: string;
  metadata: RequestMetadata;
  userId: string;
}): Promise<number> {
  const connection = await prisma.calendarConnection.findFirst({
    where: {
      feedUrlEncrypted: { not: null },
      id: input.connectionId,
      userId: input.userId,
    },
    select: { id: true, provider: true },
  });

  if (!connection) throw feedNotFoundError();

  return prisma.$transaction(async (tx) => {
    const events = await tx.event.deleteMany({
      where: { calendarConnectionId: connection.id, userId: input.userId },
    });
    const deleted = await tx.calendarConnection.deleteMany({
      where: {
        feedUrlEncrypted: { not: null },
        id: connection.id,
        userId: input.userId,
      },
    });

    if (deleted.count !== 1) throw changedFeedError();

    await tx.auditLog.create({
      data: {
        action: "CALENDAR_FEED_DISCONNECTED",
        actorUserId: input.userId,
        entityId: connection.id,
        entityType: "CalendarConnection",
        ipHash: input.metadata.ipHash,
        metadata: {
          deletedEventsTotal: events.count,
          provider: connection.provider,
        },
        userAgent: input.metadata.userAgent,
      },
    });

    return events.count;
  }, transactionOptions());
}

async function findOwnedFeedConnection(
  connectionId: string,
  userId: string,
): Promise<FeedConnectionRecord> {
  const connection = await prisma.calendarConnection.findFirst({
    where: {
      feedUrlEncrypted: { not: null },
      id: connectionId,
      provider: { in: ["GOOGLE", "APPLE"] },
      userId,
    },
    select: {
      displayName: true,
      feedContentHash: true,
      feedEtag: true,
      feedLastModified: true,
      feedSnapshotAt: true,
      feedUrlEncrypted: true,
      id: true,
      provider: true,
    },
  });

  if (
    !connection?.feedUrlEncrypted ||
    (connection.provider !== "GOOGLE" && connection.provider !== "APPLE")
  ) {
    throw feedNotFoundError();
  }

  return {
    ...connection,
    feedUrlEncrypted: connection.feedUrlEncrypted,
    provider: connection.provider,
  };
}

async function markFeedUnchanged(input: {
  connection: FeedConnectionRecord;
  etag: string | null;
  lastModified: string | null;
  metadata: RequestMetadata;
  syncedAt: Date;
  userId: string;
}): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.calendarConnection.updateMany({
      where: {
        feedUrlEncrypted: { not: null },
        id: input.connection.id,
        userId: input.userId,
      },
      data: {
        feedEtag: input.etag ?? input.connection.feedEtag,
        feedLastModified:
          input.lastModified ?? input.connection.feedLastModified,
        lastSyncedAt: input.syncedAt,
      },
    });

    if (updated.count !== 1) throw changedFeedError();

    const eventCount = await tx.event.count({
      where: {
        calendarConnectionId: input.connection.id,
        userId: input.userId,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "CALENDAR_FEED_SYNCED",
        actorUserId: input.userId,
        entityId: input.connection.id,
        entityType: "CalendarConnection",
        ipHash: input.metadata.ipHash,
        metadata: {
          deleted: 0,
          imported: 0,
          provider: input.connection.provider,
          skipped: 0,
          unchanged: true,
        },
        userAgent: input.metadata.userAgent,
      },
    });

    return eventCount;
  }, transactionOptions());
}

async function replaceFeedSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
  provider: CalendarFeedProvider,
  events: NormalizedCalendarFeedEvent[],
): Promise<number> {
  await upsertFeedEvents(tx, userId, connectionId, provider, events);
  const externalIds = events.map((event) => event.externalId);

  const stale = await tx.event.deleteMany({
    where: {
      calendarConnectionId: connectionId,
      userId,
      ...(externalIds.length
        ? {
            OR: [
              { externalId: null },
              { externalId: { notIn: externalIds } },
            ],
          }
        : {}),
    },
  });

  return stale.count;
}

async function upsertFeedEvents(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
  provider: CalendarFeedProvider,
  events: NormalizedCalendarFeedEvent[],
): Promise<void> {
  for (let index = 0; index < events.length; index += DATABASE_BATCH_SIZE) {
    const batch = events.slice(index, index + DATABASE_BATCH_SIZE);

    await Promise.all(batch.map((event) =>
      tx.event.upsert({
        where: {
          calendarConnectionId_externalId: {
            calendarConnectionId: connectionId,
            externalId: event.externalId,
          },
        },
        create: {
          allDay: event.allDay,
          calendarConnectionId: connectionId,
          description: event.description,
          endAt: event.endAt,
          externalId: event.externalId,
          location: event.location,
          recurrenceRule: event.recurrenceRule,
          source: provider,
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
          source: provider,
          startAt: event.startAt,
          title: event.title,
        },
      }),
    ));
  }
}

async function withCalendarClassification(
  result: Omit<CalendarFeedSyncResult, "analyzed" | "categorized" | "classificationMode">,
  input: {
    metadata: RequestMetadata;
    userId: string;
    userTimeZone: string;
  },
): Promise<CalendarFeedSyncResult> {
  if (result.unchanged) {
    try {
      if (await recentClassificationIsFresh(input, result.connectionId)) {
        return {
          ...result,
          analyzed: 0,
          categorized: 0,
          classificationMode: "skipped",
        };
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Could not check calendar classification freshness", error);
      }
    }
  }

  const classification = await safelyClassifyImportedCalendarMonth({
    connectionId: result.connectionId,
    metadata: input.metadata,
    userId: input.userId,
    userTimeZone: input.userTimeZone,
  });

  return {
    ...result,
    analyzed: classification.analyzed,
    categorized: classification.categorized,
    classificationMode: classification.mode,
  };
}

async function recentClassificationIsFresh(
  input: { userId: string; userTimeZone: string },
  connectionId: string,
): Promise<boolean> {
  const range = calendarClassificationUtcRange(new Date(), input.userTimeZone);
  const [classification, latestCategory] = await Promise.all([
    prisma.auditLog.findFirst({
      where: {
        action: "CALENDAR_EVENTS_CLASSIFIED",
        actorUserId: input.userId,
        createdAt: { gte: range.start, lt: range.end },
        entityId: connectionId,
        entityType: "CalendarConnection",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.balanceCategory.findFirst({
      where: { isArchived: false, userId: input.userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return Boolean(
    classification
    && (!latestCategory || latestCategory.updatedAt <= classification.createdAt),
  );
}

function transactionOptions() {
  return { maxWait: 5_000, timeout: 30_000 };
}

function syncedAtDistance(value: Date): number {
  return Math.max(0, Date.now() - value.getTime());
}

function duplicateFeedError(): CalendarFeedError {
  return new CalendarFeedError(
    "calendar_feed_already_connected",
    "Этот календарь уже подключён",
    409,
  );
}

function feedNotFoundError(): CalendarFeedError {
  return new CalendarFeedError(
    "calendar_feed_not_found",
    "Подключённый календарь не найден",
    404,
  );
}

function changedFeedError(): CalendarFeedError {
  return new CalendarFeedError(
    "calendar_feed_changed",
    "Подключение календаря изменилось во время операции. Обновите страницу",
    409,
  );
}
