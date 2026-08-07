import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const goalSelect = {
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
    select: {
      id: true,
      name: true,
      color: true,
      icon: true,
    },
  },
} satisfies Prisma.GoalSelect;

export type GoalRecord = Prisma.GoalGetPayload<{ select: typeof goalSelect }>;

export type GoalDto = Omit<GoalRecord, "createdAt" | "targetDate" | "updatedAt"> & {
  createdAt: string;
  targetDate: string | null;
  updatedAt: string;
};

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();

const nullableDate = z
  .union([
    z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((value) => new Date(value))
      .refine((value) => !Number.isNaN(value.getTime()), "Invalid date"),
    z.null(),
  ]);

const finiteValue = z.number().finite().min(0).max(1_000_000_000_000);
const targetValue = z.number().finite().positive().max(1_000_000_000_000);

export const createGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: nullableText(10_000).optional(),
    categoryId: z.string().trim().min(1).max(191).nullable().optional(),
    unit: z.string().trim().max(32).default(""),
    currentValue: finiteValue.default(0),
    targetValue,
    targetDate: nullableDate.optional(),
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  })
  .strict();

export const updateGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableText(10_000).optional(),
    categoryId: z.string().trim().min(1).max(191).nullable().optional(),
    unit: z.string().trim().max(32).optional(),
    currentValue: finiteValue.optional(),
    targetValue: targetValue.optional(),
    targetDate: nullableDate.optional(),
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
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
  };
}
