import type { Prisma } from "@prisma/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { z } from "zod";

export function currentWeekBounds(timeZone: string, now = new Date()) {
  const local = toZonedTime(now, timeZone);
  const dayFromMonday = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - dayFromMonday);
  local.setHours(0, 0, 0, 0);
  const start = fromZonedTime(local, timeZone);
  const nextLocal = new Date(local);
  nextLocal.setDate(nextLocal.getDate() + 7);
  return { start, end: fromZonedTime(nextLocal, timeZone) };
}

export function goalSelectForTimeZone(timeZone: string, now = new Date()) {
  const week = currentWeekBounds(timeZone, now);
  return {
    id: true,
    categoryId: true,
    title: true,
    description: true,
    unit: true,
    currentValue: true,
    targetValue: true,
    targetDate: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    category: {
      select: { id: true, name: true, color: true, icon: true },
    },
    tasks: {
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        kind: true,
        targetPerWeek: true,
        durationMinutes: true,
        status: true,
        completedAt: true,
        sortOrder: true,
        events: {
          where: {
            status: "COMPLETED",
            startAt: { gte: week.start, lt: week.end },
          },
          select: { id: true },
        },
        _count: {
          select: { events: { where: { status: "COMPLETED" } } },
        },
      },
    },
  } as const satisfies Prisma.GoalSelect;
}

export type GoalRecord = Prisma.GoalGetPayload<{
  select: ReturnType<typeof goalSelectForTimeZone>;
}>;

export type GoalTaskDto = {
  id: string;
  title: string;
  description: string | null;
  kind: "HABIT" | "MILESTONE";
  targetPerWeek: number | null;
  durationMinutes: number;
  status: "ACTIVE" | "COMPLETED";
  completedAt: string | null;
  sortOrder: number;
  completedThisWeek: number;
};

export type GoalDto = Omit<GoalRecord, "createdAt" | "targetDate" | "tasks" | "updatedAt"> & {
  createdAt: string;
  targetDate: string | null;
  tasks: GoalTaskDto[];
  updatedAt: string;
};

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();

const nullableDate = z.union([
  z.string().trim().min(1).max(64).transform((value) => new Date(value)).refine((value) => !Number.isNaN(value.getTime()), "Invalid date"),
  z.null(),
]);

const finiteValue = z.number().finite().min(0).max(1_000_000_000_000);
const targetValue = z.number().finite().positive().max(1_000_000_000_000);

export const goalTaskInputSchema = z
  .object({
    id: z.string().trim().min(1).max(191).optional(),
    title: z.string().trim().min(1).max(200),
    description: nullableText(2_000).optional(),
    kind: z.enum(["HABIT", "MILESTONE"]),
    targetPerWeek: z.number().int().min(1).max(14).nullable(),
    durationMinutes: z.number().int().min(5).max(480),
    status: z.enum(["ACTIVE", "COMPLETED"]).default("ACTIVE"),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.kind === "HABIT" && task.targetPerWeek === null) {
      context.addIssue({ code: "custom", path: ["targetPerWeek"], message: "A weekly target is required for a habit" });
    }
    if (task.kind === "MILESTONE" && task.targetPerWeek !== null) {
      context.addIssue({ code: "custom", path: ["targetPerWeek"], message: "A milestone cannot have a weekly target" });
    }
  });

const goalFields = {
  title: z.string().trim().min(1).max(200),
  description: nullableText(10_000).optional(),
  categoryId: z.string().trim().min(1).max(191).nullable().optional(),
  unit: z.string().trim().max(32).default(""),
  currentValue: finiteValue.default(0),
  targetValue,
  targetDate: nullableDate.optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  tasks: z.array(goalTaskInputSchema).max(20).default([]),
};

export const createGoalSchema = z.object(goalFields).strict();

export const updateGoalSchema = z
  .object({
    title: goalFields.title.optional(),
    description: goalFields.description,
    categoryId: goalFields.categoryId,
    unit: goalFields.unit.optional(),
    currentValue: goalFields.currentValue.optional(),
    targetValue: goalFields.targetValue.optional(),
    targetDate: goalFields.targetDate,
    status: goalFields.status.optional(),
    tasks: goalFields.tasks.optional(),
  })
  .strict()
  .refine((goal) => Object.keys(goal).length > 0, "At least one field is required");

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const goalsQuerySchema = z
  .object({
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
    includeArchived: queryBoolean.default(false),
  })
  .strict();

export function serializeGoal(goal: GoalRecord): GoalDto {
  return {
    ...goal,
    createdAt: goal.createdAt.toISOString(),
    targetDate: goal.targetDate?.toISOString() ?? null,
    updatedAt: goal.updatedAt.toISOString(),
    tasks: goal.tasks.map(({ events, _count, completedAt, ...task }) => ({
      ...task,
      completedAt: completedAt?.toISOString() ?? null,
      completedThisWeek: events.length,
      ...(task.kind === "MILESTONE" && _count.events > 0 ? { status: "COMPLETED" as const } : {}),
    })),
  };
}
