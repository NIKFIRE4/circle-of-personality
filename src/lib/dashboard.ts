import { cache } from "react";
import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import { prisma } from "@/lib/db";
import {
  MAX_STREAK_DAYS,
  averageProgress,
  buildMetrics,
  calculateDayProgress,
  calculateStreakDays,
  countUnassignedEvents,
  summarizeConfiguredMetrics,
  type DashboardMathEvent,
} from "@/lib/dashboard-math";

export type { BalanceMetric } from "@/lib/dashboard-math";

type ProgressEvent = DashboardMathEvent & {
  id: string;
  title: string;
  category: { name: string; color: string } | null;
};

const DAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

export const getDashboardData = cache(
  async (userId: string, timeZone: string) =>
    getDashboardDataAt(userId, timeZone, new Date()),
);

export async function getDashboardDataAt(
  userId: string,
  timeZone: string,
  now: Date,
) {
  const localNow = toZonedTime(now, timeZone);
  const weekStartLocal = startOfWeek(localNow, { weekStartsOn: 1 });
  weekStartLocal.setHours(0, 0, 0, 0);
  const weekEndLocal = addDays(weekStartLocal, 7);
  const previousWeekStartLocal = addDays(weekStartLocal, -7);
  const dayStartLocal = new Date(localNow);
  dayStartLocal.setHours(0, 0, 0, 0);
  const dayEndLocal = addDays(dayStartLocal, 1);
  const streakStartLocal = addDays(dayStartLocal, -MAX_STREAK_DAYS);

  const weekStart = fromZonedTime(weekStartLocal, timeZone);
  const weekEnd = fromZonedTime(weekEndLocal, timeZone);
  const previousWeekStart = fromZonedTime(previousWeekStartLocal, timeZone);
  const dayStart = fromZonedTime(dayStartLocal, timeZone);
  const dayEnd = fromZonedTime(dayEndLocal, timeZone);
  const streakStart = fromZonedTime(streakStartLocal, timeZone);

  const [categories, events, streakEvents] = await Promise.all([
    prisma.balanceCategory.findMany({
      where: { userId, isArchived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        targetMinutesPerWeek: true,
      },
    }),
    prisma.event.findMany({
      where: {
        userId,
        endAt: { gt: previousWeekStart },
        startAt: { lt: weekEnd },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        allDay: true,
        includeInBalance: true,
        status: true,
        categoryId: true,
        category: { select: { name: true, color: true } },
      },
    }),
    prisma.event.findMany({
      where: {
        userId,
        status: "COMPLETED",
        endAt: { gt: streakStart },
        startAt: { lt: dayEnd },
      },
      select: {
        startAt: true,
        endAt: true,
        allDay: true,
        status: true,
      },
    }),
  ]);

  const typedEvents = events as ProgressEvent[];
  const currentMetrics = buildMetrics(categories, typedEvents, weekStart, weekEnd);
  const previousMetrics = buildMetrics(
    categories,
    typedEvents,
    previousWeekStart,
    weekStart,
  );
  const currentSummary = summarizeConfiguredMetrics(currentMetrics);
  const total = currentSummary.total;
  const previousTotal = averageProgress(previousMetrics);
  const todayEvents = typedEvents
    .filter(
      (event) =>
        event.status !== "CANCELLED" &&
        event.startAt < dayEnd &&
        event.endAt > dayStart,
    )
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  return {
    weekStartAt: weekStart.toISOString(),
    weekEndAt: weekEnd.toISOString(),
    metrics: currentMetrics,
    total,
    previousTotal,
    change: total - previousTotal,
    completedMinutes: currentSummary.completedMinutes,
    targetMinutes: currentSummary.targetMinutes,
    unassignedEvents: countUnassignedEvents(typedEvents, weekStart, weekEnd),
    todayEvents: todayEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      allDay: event.allDay,
      status: event.status,
      category: event.category?.name ?? "Без категории",
    })),
    todayCompleted: todayEvents.filter((event) => event.status === "COMPLETED")
      .length,
    weekDays: DAY_LABELS.map((label, index) => {
      const startLocal = addDays(weekStartLocal, index);
      const endLocal = addDays(startLocal, 1);
      const start = fromZonedTime(startLocal, timeZone);
      const end = fromZonedTime(endLocal, timeZone);
      const progress = calculateDayProgress(typedEvents, start, end);

      return {
        label,
        value: progress.value,
        planned: progress.planned,
        active:
          formatInTimeZone(start, timeZone, "yyyy-MM-dd") ===
          formatInTimeZone(now, timeZone, "yyyy-MM-dd"),
      };
    }),
    streakDays: calculateStreakDays(streakEvents, now, timeZone),
    topCategory:
      currentMetrics.filter((metric) => metric.targetMinutes > 0).sort(
        (left, right) => right.completedMinutes - left.completedMinutes,
      )[0] ?? null,
  };
}
