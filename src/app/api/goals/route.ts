import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createGoalSchema, goalsQuerySchema, goalSelectForTimeZone, serializeGoal } from "@/lib/goals";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return user;
}

async function assertOwnedActiveCategory(categoryId: string | null | undefined, userId: string) {
  if (!categoryId) return;
  const category = await prisma.balanceCategory.findFirst({
    where: { id: categoryId, userId, isArchived: false },
    select: { id: true },
  });
  if (!category) throw new ApiError(422, "INVALID_CATEGORY", "Category does not belong to this user");
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const parsed = goalsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      includeArchived: url.searchParams.get("includeArchived") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Query validation failed", parsed.error.issues);
    }

    const goals = await prisma.goal.findMany({
      where: {
        userId: user.id,
        ...(parsed.data.status
          ? { status: parsed.data.status }
          : parsed.data.includeArchived
            ? {}
            : { status: { not: "ARCHIVED" } }),
      },
      select: goalSelectForTimeZone(user.timeZone),
      orderBy: [{ status: "asc" }, { targetDate: "asc" }, { createdAt: "desc" }],
    });

    return jsonResponse({ goals: goals.map(serializeGoal) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, createGoalSchema);
    await assertOwnedActiveCategory(input.categoryId, user.id);
    const metadata = getRequestMetadata(request);

    const goal = await prisma.$transaction(async (tx) => {
      const created = await tx.goal.create({
        data: {
          userId: user.id,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          unit: input.unit,
          currentValue: input.currentValue,
          targetValue: input.targetValue,
          targetDate: input.targetDate,
          status: input.status,
          tasks: {
            create: input.tasks.map((task, sortOrder) => ({
              userId: user.id,
              title: task.title,
              description: task.description,
              kind: task.kind,
              targetPerWeek: task.targetPerWeek,
              durationMinutes: task.durationMinutes,
              status: task.status,
              completedAt: task.status === "COMPLETED" ? new Date() : null,
              sortOrder,
            })),
          },
        },
        select: goalSelectForTimeZone(user.timeZone),
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "GOAL_CREATED",
          entityType: "Goal",
          entityId: created.id,
          metadata: { categoryId: created.categoryId, status: created.status, taskCount: created.tasks.length },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "goal.created",
          aggregateType: "Goal",
          aggregateId: created.id,
          payload: { goalId: created.id, userId: user.id },
        },
      });

      return created;
    });

    return jsonResponse({ goal: serializeGoal(goal) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
