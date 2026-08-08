import { Prisma } from "@prisma/client";

import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createEventSchema, eventSelect, eventsQuerySchema } from "@/lib/events";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  return user;
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const parsed = eventsQuerySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      categoryId: url.searchParams.get("categoryId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Query validation failed",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    const { from, to, categoryId, status, search, limit } = parsed.data;
    const where: Prisma.EventWhereInput = {
      userId: user.id,
      ...(categoryId ? { categoryId } : {}),
      ...(status ? { status } : {}),
      ...(from ? { endAt: { gt: from } } : {}),
      ...(to ? { startAt: { lt: to } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const events = await prisma.event.findMany({
      where,
      select: eventSelect,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: limit,
    });

    return jsonResponse({ events });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, createEventSchema);
    const metadata = getRequestMetadata(request);
    let linkedGoal: { id: string; categoryId: string | null } | null = null;

    if (input.categoryId) {
      const ownsCategory = await prisma.balanceCategory.findFirst({
        where: { id: input.categoryId, userId: user.id, isArchived: false },
        select: { id: true },
      });

      if (!ownsCategory) {
        throw new ApiError(422, "INVALID_CATEGORY", "Category does not belong to this user");
      }
    }

    if (input.goalId) {
      linkedGoal = await prisma.goal.findFirst({
        where: { id: input.goalId, userId: user.id, status: "ACTIVE" },
        select: { id: true, categoryId: true },
      });
      if (!linkedGoal) throw new ApiError(422, "INVALID_GOAL", "Цель не найдена или уже не активна");
    }
    if (input.goalTaskId) {
      const ownsTask = await prisma.goalTask.findFirst({
        where: { id: input.goalTaskId, userId: user.id, goalId: input.goalId ?? undefined, status: "ACTIVE" },
        select: { id: true },
      });
      if (!ownsTask) throw new ApiError(422, "INVALID_GOAL_TASK", "Шаг не принадлежит выбранной цели или уже завершён");
    }

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          userId: user.id,
          categoryId: input.categoryId ?? linkedGoal?.categoryId,
          goalId: input.goalId,
          goalTaskId: input.goalTaskId,
          title: input.title,
          description: input.description,
          location: input.location,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          includeInBalance: input.includeInBalance,
          status: input.status,
          source: input.source,
          completedAt: input.status === "COMPLETED" ? new Date() : null,
        },
        select: eventSelect,
      });

      if (input.source === "VOICE" && input.voiceCommandId) {
        const claimed = await tx.voiceCommand.updateMany({ where: { id: input.voiceCommandId, userId: user.id, status: "PARSED", eventId: null }, data: { eventId: created.id, status: "APPLIED" } });
        if (claimed.count !== 1) throw new ApiError(422, "INVALID_VOICE_COMMAND", "Voice command is missing, already applied, or does not belong to this user");
      }

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "EVENT_CREATED",
          entityType: "Event",
          entityId: created.id,
          metadata: { source: created.source, status: created.status },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "event.created",
          aggregateType: "Event",
          aggregateId: created.id,
          payload: {
            eventId: created.id,
            userId: user.id,
            source: created.source,
          },
        },
      });

      return created;
    });

    return jsonResponse({ event }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
