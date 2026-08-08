import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventSelect, unsupportedExternalEventFields, updateEventSchema } from "@/lib/events";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

type EventRouteContext = {
  params: Promise<{ id: string }>;
};

async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  return user;
}

async function getOwnedEvent(id: string, userId: string) {
  const event = await prisma.event.findFirst({
    where: { id, userId },
    select: eventSelect,
  });

  if (!event) {
    throw new ApiError(404, "EVENT_NOT_FOUND", "Event was not found");
  }

  return event;
}

export async function GET(_request: Request, context: EventRouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const event = await getOwnedEvent(id, user.id);

    return jsonResponse({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: EventRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = await parseJson(request, updateEventSchema);
    const existing = await getOwnedEvent(id, user.id);
    const metadata = getRequestMetadata(request);

    if (existing.calendarConnectionId) {
      const unsupportedFields = unsupportedExternalEventFields(Object.keys(input));
      if (unsupportedFields.length) {
        throw new ApiError(
          409,
          "EXTERNAL_EVENT_READ_ONLY",
          "Событие импортировано из внешнего календаря. Здесь можно изменить только сферу и статус.",
          { unsupportedFields },
        );
      }
    }

    const nextStartAt = input.startAt ?? existing.startAt;
    const nextEndAt = input.endAt ?? existing.endAt;

    if (nextEndAt <= nextStartAt) {
      throw new ApiError(422, "INVALID_EVENT_RANGE", "endAt must be later than startAt");
    }

    if (input.categoryId && input.categoryId !== existing.categoryId) {
      const ownsCategory = await prisma.balanceCategory.findFirst({
        where: { id: input.categoryId, userId: user.id, isArchived: false },
        select: { id: true },
      });

      if (!ownsCategory) {
        throw new ApiError(422, "INVALID_CATEGORY", "Category does not belong to this user");
      }
    }
    const nextGoalId = input.goalId === undefined ? existing.goalId : input.goalId;
    const nextGoalTaskId = input.goalTaskId === undefined
      ? (input.goalId !== undefined && input.goalId !== existing.goalId ? null : existing.goalTaskId)
      : input.goalTaskId;
    let linkedGoal: { id: string; categoryId: string | null } | null = null;
    if (nextGoalId) {
      linkedGoal = await prisma.goal.findFirst({
        where: {
          id: nextGoalId,
          userId: user.id,
          ...(nextGoalId === existing.goalId ? {} : { status: "ACTIVE" }),
        },
        select: { id: true, categoryId: true },
      });
      if (!linkedGoal) throw new ApiError(422, "INVALID_GOAL", "Цель не найдена или уже не активна");
    }
    if (nextGoalTaskId) {
      if (!nextGoalId) throw new ApiError(422, "INVALID_GOAL_TASK", "Для шага нужно выбрать цель");
      const ownsTask = await prisma.goalTask.findFirst({
        where: {
          id: nextGoalTaskId,
          userId: user.id,
          goalId: nextGoalId,
          ...(nextGoalTaskId === existing.goalTaskId ? {} : { status: "ACTIVE" }),
        },
        select: { id: true },
      });
      if (!ownsTask) throw new ApiError(422, "INVALID_GOAL_TASK", "Шаг не принадлежит выбранной цели или уже завершён");
    }

    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: existing.id },
        data: {
          ...input,
          ...(input.goalId !== undefined && input.goalTaskId === undefined && input.goalId !== existing.goalId
            ? { goalTaskId: null }
            : {}),
          ...(input.goalId !== undefined && input.categoryId === undefined && input.goalId !== existing.goalId
            ? { categoryId: linkedGoal?.categoryId ?? existing.categoryId }
            : {}),
          ...(input.status === "COMPLETED" && !existing.completedAt
            ? { completedAt: new Date() }
            : {}),
          ...(input.status && input.status !== "COMPLETED" ? { completedAt: null } : {}),
        },
        select: eventSelect,
      });

      const changedFields = Object.keys(input);

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "EVENT_UPDATED",
          entityType: "Event",
          entityId: updated.id,
          metadata: { changedFields },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "event.updated",
          aggregateType: "Event",
          aggregateId: updated.id,
          payload: { eventId: updated.id, userId: user.id, changedFields },
        },
      });

      return updated;
    });

    return jsonResponse({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, context: EventRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const existing = await getOwnedEvent(id, user.id);
    const metadata = getRequestMetadata(request);

    if (existing.calendarConnectionId) {
      throw new ApiError(
        409,
        "EXTERNAL_EVENT_DELETE_UNSUPPORTED",
        "Удалите событие в исходном календаре и запустите синхронизацию.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.event.delete({ where: { id: existing.id } });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "EVENT_DELETED",
          entityType: "Event",
          entityId: existing.id,
          metadata: { source: existing.source, externalId: existing.externalId },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "event.deleted",
          aggregateType: "Event",
          aggregateId: existing.id,
          payload: {
            eventId: existing.id,
            userId: user.id,
            source: existing.source,
            externalId: existing.externalId,
          },
        },
      });
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error);
  }
}
