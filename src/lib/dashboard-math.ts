import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const MAX_STREAK_DAYS = 366;

export type DashboardEventStatus = "PLANNED" | "COMPLETED" | "CANCELLED";

export type DashboardMathEvent = {
  startAt: Date;
  endAt: Date;
  status: DashboardEventStatus;
  categoryId: string | null;
  allDay: boolean;
};

export type DashboardCategory = {
  id: string;
  name: string;
  slug: string;
  color: string;
  targetMinutesPerWeek: number;
};

export type BalanceMetric = {
  id: string;
  name: string;
  slug: string;
  color: string;
  value: number;
  completedMinutes: number;
  targetMinutes: number;
};

export function buildMetrics(
  categories: DashboardCategory[],
  events: DashboardMathEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): BalanceMetric[] {
  return categories.map((category) => {
    const completedMinutes = Math.round(
      events
        .filter(
          (event) =>
            !event.allDay &&
            event.categoryId === category.id &&
            event.status !== "CANCELLED" &&
            event.startAt < rangeEnd &&
            event.endAt > rangeStart,
        )
        .reduce(
          (sum, event) => sum + overlapMinutes(event, rangeStart, rangeEnd),
          0,
        ),
    );
    const targetMinutes = Math.max(0, category.targetMinutesPerWeek);

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      color: category.color,
      value: targetMinutes
        ? clampPercent((completedMinutes / targetMinutes) * 100)
        : 0,
      completedMinutes,
      targetMinutes,
    };
  });
}

export function averageProgress(metrics: BalanceMetric[]): number {
  const configured = metrics.filter((metric) => metric.targetMinutes > 0);

  if (!configured.length) {
    return 0;
  }

  return Math.round(
    configured.reduce((sum, metric) => sum + metric.value, 0) /
      configured.length,
  );
}

export function summarizeConfiguredMetrics(metrics: BalanceMetric[]) {
  const configured = metrics.filter((metric) => metric.targetMinutes > 0);

  return {
    total: averageProgress(configured),
    completedMinutes: configured.reduce(
      (sum, metric) => sum + metric.completedMinutes,
      0,
    ),
    targetMinutes: configured.reduce(
      (sum, metric) => sum + metric.targetMinutes,
      0,
    ),
  };
}

export function calculateDayProgress(
  events: DashboardMathEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): { value: number; planned: boolean } {
  const scheduled = events.filter(
    (event) =>
      !event.allDay &&
      event.status !== "CANCELLED" &&
      event.startAt < rangeEnd &&
      event.endAt > rangeStart,
  );
  const scheduledMinutes = scheduled.reduce(
    (sum, event) => sum + overlapMinutes(event, rangeStart, rangeEnd),
    0,
  );
  const doneMinutes = scheduled
    .filter((event) => event.status === "COMPLETED")
    .reduce(
      (sum, event) => sum + overlapMinutes(event, rangeStart, rangeEnd),
      0,
    );

  return {
    value: scheduledMinutes
      ? clampPercent((doneMinutes / scheduledMinutes) * 100)
      : 0,
    planned: scheduledMinutes > 0,
  };
}

export function overlapMinutes(
  event: Pick<DashboardMathEvent, "startAt" | "endAt">,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const start = Math.max(event.startAt.getTime(), rangeStart.getTime());
  const end = Math.min(event.endAt.getTime(), rangeEnd.getTime());
  return Math.max(0, end - start) / 60_000;
}

export function calculateStreakDays(
  events: Array<
    Pick<DashboardMathEvent, "startAt" | "endAt" | "status">
  >,
  now: Date,
  timeZone: string,
  maxDays = MAX_STREAK_DAYS,
): number {
  if (maxDays <= 0) {
    return 0;
  }

  const localToday = toZonedTime(now, timeZone);
  localToday.setHours(12, 0, 0, 0);
  const earliestLocalDate = addDays(localToday, -maxDays);
  const completedDates = new Set<string>();

  for (const event of events) {
    if (event.status !== "COMPLETED" || event.endAt <= event.startAt) {
      continue;
    }

    const localStart = toZonedTime(event.startAt, timeZone);
    localStart.setHours(12, 0, 0, 0);
    const localEnd = toZonedTime(
      new Date(event.endAt.getTime() - 1),
      timeZone,
    );
    localEnd.setHours(12, 0, 0, 0);
    let cursor =
      localStart < earliestLocalDate ? new Date(earliestLocalDate) : localStart;
    const lastDate = localEnd < localToday ? localEnd : localToday;

    while (cursor <= lastDate) {
      completedDates.add(localDateKey(cursor, timeZone));
      cursor = addDays(cursor, 1);
    }
  }

  let cursor = new Date(localToday);
  if (!completedDates.has(localDateKey(cursor, timeZone))) {
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  while (
    streak < maxDays &&
    completedDates.has(localDateKey(cursor, timeZone))
  ) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function localDateKey(localDate: Date, timeZone: string): string {
  return formatInTimeZone(
    fromZonedTime(localDate, timeZone),
    timeZone,
    "yyyy-MM-dd",
  );
}
