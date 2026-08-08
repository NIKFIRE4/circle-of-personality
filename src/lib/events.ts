import { Prisma } from "@prisma/client";
import { z } from "zod";

export const eventSelect = {
  id: true,
  userId: true,
  categoryId: true,
  goalId: true,
  goalTaskId: true,
  calendarConnectionId: true,
  title: true,
  description: true,
  location: true,
  startAt: true,
  endAt: true,
  allDay: true,
  includeInBalance: true,
  status: true,
  source: true,
  externalId: true,
  recurrenceRule: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      icon: true,
    },
  },
  goal: {
    select: { id: true, title: true, status: true },
  },
  goalTask: {
    select: { id: true, title: true, kind: true },
  },
} satisfies Prisma.EventSelect;

const dateString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => new Date(value))
  .refine((value) => !Number.isNaN(value.getTime()), "Invalid date-time");

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();

export const createEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: nullableText(10_000).optional(),
    location: nullableText(500).optional(),
    categoryId: z.string().trim().min(1).max(191).nullable().optional(),
    goalId: z.string().trim().min(1).max(191).nullable().optional(),
    goalTaskId: z.string().trim().min(1).max(191).nullable().optional(),
    startAt: dateString,
    endAt: dateString,
    allDay: z.boolean().default(false),
    includeInBalance: z.boolean().default(true),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).default("PLANNED"),
    source: z.enum(["MANUAL", "VOICE"]).default("MANUAL"),
    voiceCommandId: z.string().trim().min(1).max(191).nullable().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.endAt <= event.startAt) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "endAt must be later than startAt",
      });
    }
    if (event.source === "VOICE" && !event.voiceCommandId) {
      context.addIssue({ code: "custom", path: ["voiceCommandId"], message: "voiceCommandId is required for voice events" });
    }
    if (event.source !== "VOICE" && event.voiceCommandId) {
      context.addIssue({ code: "custom", path: ["voiceCommandId"], message: "voiceCommandId is only allowed for voice events" });
    }
    if (event.goalTaskId && !event.goalId) {
      context.addIssue({ code: "custom", path: ["goalId"], message: "goalId is required when goalTaskId is set" });
    }
  });

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableText(10_000).optional(),
    location: nullableText(500).optional(),
    categoryId: z.string().trim().min(1).max(191).nullable().optional(),
    goalId: z.string().trim().min(1).max(191).nullable().optional(),
    goalTaskId: z.string().trim().min(1).max(191).nullable().optional(),
    startAt: dateString.optional(),
    endAt: dateString.optional(),
    allDay: z.boolean().optional(),
    includeInBalance: z.boolean().optional(),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
  })
  .strict()
  .refine((event) => Object.keys(event).length > 0, "At least one field is required");

export const eventsQuerySchema = z
  .object({
    from: dateString.optional(),
    to: dateString.optional(),
    categoryId: z.string().trim().min(1).max(191).optional(),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(250),
  })
  .superRefine((query, context) => {
    if (query.from && query.to && query.to <= query.from) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be later than from",
      });
    }
  });

const EXTERNAL_LOCAL_EVENT_FIELDS = new Set(["categoryId", "goalId", "goalTaskId", "status", "includeInBalance"]);

export function unsupportedExternalEventFields(fields: string[]): string[] {
  return fields.filter((field) => !EXTERNAL_LOCAL_EVENT_FIELDS.has(field));
}
