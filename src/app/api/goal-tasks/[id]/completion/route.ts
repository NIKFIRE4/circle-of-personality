import { z } from "zod";

import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentWeekBounds, goalSelectForTimeZone, serializeGoal } from "@/lib/goals";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

const completionSchema = z.object({ completed: z.boolean() }).strict();
type TaskRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: TaskRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
    const { id } = await context.params;
    const input = await parseJson(request, completionSchema);
    const metadata = getRequestMetadata(request);
    const task = await prisma.goalTask.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        goalId: true,
        title: true,
        kind: true,
        status: true,
        durationMinutes: true,
        goal: { select: { categoryId: true, status: true } },
      },
    });
    if (!task) throw new ApiError(404, "GOAL_TASK_NOT_FOUND", "Goal task was not found");
    if (input.completed && task.goal.status !== "ACTIVE") {
      throw new ApiError(409, "GOAL_NOT_ACTIVE", "Завершённую или архивную цель нужно сначала вернуть в активные");
    }

    const now = new Date();
    const week = currentWeekBounds(user.timeZone, now);
    await prisma.$transaction(async (tx) => {
      if (input.completed) {
        if (task.kind === "MILESTONE" && task.status === "COMPLETED") return;
        const endAt = new Date(now.getTime() + task.durationMinutes * 60_000);
        await tx.event.create({
          data: {
            userId: user.id,
            categoryId: task.goal.categoryId,
            goalId: task.goalId,
            goalTaskId: task.id,
            title: task.title,
            startAt: now,
            endAt,
            status: "COMPLETED",
            completedAt: now,
            source: "GOAL",
          },
        });
        if (task.kind === "MILESTONE") {
          await tx.goalTask.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: now } });
        }
      } else {
        const latest = await tx.event.findFirst({
          where: {
            userId: user.id,
            goalTaskId: task.id,
            ...(task.kind === "HABIT" ? { source: "GOAL" as const } : {}),
            status: "COMPLETED",
            startAt: task.kind === "HABIT" ? { gte: week.start, lt: week.end } : undefined,
          },
          select: { id: true, source: true },
          orderBy: { startAt: "desc" },
        });
        if (latest?.source === "GOAL") await tx.event.delete({ where: { id: latest.id } });
        else if (latest) await tx.event.update({ where: { id: latest.id }, data: { status: "PLANNED", completedAt: null } });
        if (task.kind === "MILESTONE") {
          await tx.goalTask.update({ where: { id: task.id }, data: { status: "ACTIVE", completedAt: null } });
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: input.completed ? "GOAL_TASK_COMPLETED" : "GOAL_TASK_REOPENED",
          entityType: "GoalTask",
          entityId: task.id,
          metadata: { goalId: task.goalId, kind: task.kind },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
    });

    const goal = await prisma.goal.findFirst({
      where: { id: task.goalId, userId: user.id },
      select: goalSelectForTimeZone(user.timeZone),
    });
    if (!goal) throw new ApiError(404, "GOAL_NOT_FOUND", "Goal was not found");
    return jsonResponse({ goal: serializeGoal(goal) });
  } catch (error) {
    return handleRouteError(error);
  }
}
