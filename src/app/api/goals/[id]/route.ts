import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { goalSelectForTimeZone, serializeGoal, updateGoalSchema } from "@/lib/goals";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

type GoalRouteContext = { params: Promise<{ id: string }> };

async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return user;
}

async function getOwnedGoal(id: string, userId: string, timeZone: string) {
  const goal = await prisma.goal.findFirst({ where: { id, userId }, select: goalSelectForTimeZone(timeZone) });
  if (!goal) throw new ApiError(404, "GOAL_NOT_FOUND", "Goal was not found");
  return goal;
}

async function assertOwnedActiveCategory(categoryId: string | null | undefined, userId: string, currentCategoryId?: string | null) {
  if (!categoryId) return;
  if (categoryId === currentCategoryId) return;
  const category = await prisma.balanceCategory.findFirst({
    where: { id: categoryId, userId, isArchived: false },
    select: { id: true },
  });
  if (!category) throw new ApiError(422, "INVALID_CATEGORY", "Category does not belong to this user");
}

export async function GET(_request: Request, context: GoalRouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return jsonResponse({ goal: serializeGoal(await getOwnedGoal(id, user.id, user.timeZone)) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: GoalRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = await parseJson(request, updateGoalSchema);
    const existing = await getOwnedGoal(id, user.id, user.timeZone);
    await assertOwnedActiveCategory(input.categoryId, user.id, existing.categoryId);
    const metadata = getRequestMetadata(request);

    const goal = await prisma.$transaction(async (tx) => {
      const { tasks, ...goalFields } = input;
      if (tasks) {
        const existingIds = new Set(existing.tasks.map((task) => task.id));
        const invalidId = tasks.find((task) => task.id && !existingIds.has(task.id));
        if (invalidId) throw new ApiError(422, "INVALID_GOAL_TASK", "Task does not belong to this goal");

        const retainedIds = tasks.flatMap((task) => task.id ? [task.id] : []);
        await tx.goalTask.deleteMany({
          where: { goalId: existing.id, ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}) },
        });

        for (const [sortOrder, task] of tasks.entries()) {
          const data = {
            title: task.title,
            description: task.description,
            kind: task.kind,
            targetPerWeek: task.targetPerWeek,
            durationMinutes: task.durationMinutes,
            status: task.status,
            completedAt: task.status === "COMPLETED" ? (existing.tasks.find((item) => item.id === task.id)?.completedAt ?? new Date()) : null,
            sortOrder,
          };
          if (task.id) await tx.goalTask.update({ where: { id: task.id }, data });
          else await tx.goalTask.create({ data: { ...data, userId: user.id, goalId: existing.id } });
        }
      }

      const updated = await tx.goal.update({
        where: { id: existing.id },
        data: goalFields,
        select: goalSelectForTimeZone(user.timeZone),
      });
      const changedFields = Object.keys(input);

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "GOAL_UPDATED",
          entityType: "Goal",
          entityId: updated.id,
          metadata: { changedFields },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "goal.updated",
          aggregateType: "Goal",
          aggregateId: updated.id,
          payload: { goalId: updated.id, userId: user.id, changedFields },
        },
      });

      return updated;
    });

    return jsonResponse({ goal: serializeGoal(goal) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, context: GoalRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const existing = await getOwnedGoal(id, user.id, user.timeZone);
    const metadata = getRequestMetadata(request);

    await prisma.$transaction(async (tx) => {
      await tx.goal.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "GOAL_DELETED",
          entityType: "Goal",
          entityId: existing.id,
          metadata: { status: existing.status },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "goal.deleted",
          aggregateType: "Goal",
          aggregateId: existing.id,
          payload: { goalId: existing.id, userId: user.id },
        },
      });
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error);
  }
}
