import { describe, expect, it } from "vitest";

import {
  MAX_STREAK_DAYS,
  averageProgress,
  buildMetrics,
  calculateDayProgress,
  calculateStreakDays,
  overlapMinutes,
  summarizeConfiguredMetrics,
  type DashboardMathEvent,
} from "./dashboard-math";

const category = {
  id: "health",
  name: "Здоровье",
  slug: "health",
  color: "#fff",
  targetMinutesPerWeek: 60,
};

function event(
  startAt: string,
  endAt: string,
  overrides: Partial<DashboardMathEvent> = {},
): DashboardMathEvent {
  return {
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    status: "COMPLETED",
    categoryId: category.id,
    allDay: false,
    ...overrides,
  };
}

describe("dashboard duration math", () => {
  it("clips intervals to half-open range boundaries", () => {
    const rangeStart = new Date("2026-08-03T00:00:00.000Z");
    const rangeEnd = new Date("2026-08-04T00:00:00.000Z");

    expect(
      overlapMinutes(
        event("2026-08-02T23:30:00.000Z", "2026-08-03T01:00:00.000Z"),
        rangeStart,
        rangeEnd,
      ),
    ).toBe(60);
    expect(
      overlapMinutes(
        event("2026-08-02T23:00:00.000Z", "2026-08-03T00:00:00.000Z"),
        rangeStart,
        rangeEnd,
      ),
    ).toBe(0);
    expect(
      overlapMinutes(
        event("2026-08-04T00:00:00.000Z", "2026-08-04T01:00:00.000Z"),
        rangeStart,
        rangeEnd,
      ),
    ).toBe(0);
  });

  it("excludes all-day events from duration metrics", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-10T00:00:00.000Z");
    const metrics = buildMetrics(
      [category],
      [
        event("2026-08-03T00:00:00.000Z", "2026-08-04T00:00:00.000Z", {
          allDay: true,
        }),
        event("2026-08-03T10:00:00.000Z", "2026-08-03T10:30:00.000Z"),
      ],
      start,
      end,
    );

    expect(metrics[0]).toMatchObject({ completedMinutes: 30, value: 50 });
  });

  it("counts planned and completed tasks identically and removes deleted tasks", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-10T00:00:00.000Z");
    const [metric] = buildMetrics(
      [category],
      [
        event("2026-08-03T10:00:00.000Z", "2026-08-03T10:15:00.000Z"),
        event("2026-08-04T10:00:00.000Z", "2026-08-04T10:30:00.000Z", {
          status: "PLANNED",
        }),
        event("2026-08-05T10:00:00.000Z", "2026-08-05T11:00:00.000Z", {
          status: "CANCELLED",
        }),
      ],
      start,
      end,
    );

    expect(metric).toMatchObject({
      completedMinutes: 45,
      value: 75,
    });

    const [afterDelete] = buildMetrics(
      [category],
      [event("2026-08-03T10:00:00.000Z", "2026-08-03T10:15:00.000Z")],
      start,
      end,
    );
    expect(afterDelete).toMatchObject({
      completedMinutes: 15,
      value: 25,
    });
  });

  it("derives both metric and total percentages from rounded minutes", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-10T00:00:00.000Z");
    const [metric] = buildMetrics(
      [category],
      [event("2026-08-03T10:00:00.000Z", "2026-08-03T10:00:30.000Z")],
      start,
      end,
    );

    expect(metric.completedMinutes).toBe(1);
    expect(metric.value).toBe(2);
    expect(averageProgress([metric])).toBe(metric.value);
  });

  it("summarizes only configured spheres and averages them equally", () => {
    const summary = summarizeConfiguredMetrics([
      { id: "a", name: "A", slug: "a", color: "#fff", value: 100, completedMinutes: 60, targetMinutes: 60 },
      { id: "b", name: "B", slug: "b", color: "#fff", value: 0, completedMinutes: 0, targetMinutes: 600 },
      { id: "c", name: "C", slug: "c", color: "#fff", value: 0, completedMinutes: 240, targetMinutes: 0 },
    ]);

    expect(summary).toEqual({
      total: 50,
      completedMinutes: 60,
      targetMinutes: 660,
    });
  });

  it("distinguishes an empty day from a planned day at zero percent", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-04T00:00:00.000Z");
    const allDayOnly = calculateDayProgress(
      [
        event("2026-08-03T00:00:00.000Z", "2026-08-04T00:00:00.000Z", {
          allDay: true,
        }),
      ],
      start,
      end,
    );
    const planned = calculateDayProgress(
      [
        event("2026-08-03T10:00:00.000Z", "2026-08-03T10:30:00.000Z", {
          status: "PLANNED",
        }),
      ],
      start,
      end,
    );

    expect(allDayOnly).toEqual({ value: 0, planned: false });
    expect(planned).toEqual({ value: 0, planned: true });
  });

  it("uses only timed work in a day's completion ratio", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-04T00:00:00.000Z");
    const progress = calculateDayProgress(
      [
        event("2026-08-03T09:00:00.000Z", "2026-08-03T09:30:00.000Z"),
        event("2026-08-03T10:00:00.000Z", "2026-08-03T10:30:00.000Z", {
          status: "PLANNED",
        }),
        event("2026-08-03T00:00:00.000Z", "2026-08-04T00:00:00.000Z", {
          allDay: true,
        }),
      ],
      start,
      end,
    );

    expect(progress).toEqual({ value: 50, planned: true });
  });
});

describe("dashboard streak math", () => {
  it("credits every local date overlapped by a completed event", () => {
    const streak = calculateStreakDays(
      [
        event(
          "2026-03-08T20:30:00.000Z",
          "2026-03-09T22:30:00.000Z",
        ),
      ],
      new Date("2026-03-10T12:00:00.000Z"),
      "Europe/Moscow",
    );

    expect(streak).toBe(3);
  });

  it("keeps an exclusive midnight end out of the following day", () => {
    const streak = calculateStreakDays(
      [
        event("2026-03-09T00:00:00.000Z", "2026-03-10T00:00:00.000Z", {
          allDay: true,
        }),
      ],
      new Date("2026-03-10T12:00:00.000Z"),
      "UTC",
    );

    expect(streak).toBe(1);
  });

  it("handles a local midnight crossed during a DST change", () => {
    const streak = calculateStreakDays(
      [
        event(
          "2026-03-08T04:30:00.000Z",
          "2026-03-08T08:30:00.000Z",
        ),
      ],
      new Date("2026-03-08T12:00:00.000Z"),
      "America/New_York",
    );

    expect(streak).toBe(2);
  });

  it("caps a continuous series explicitly", () => {
    const streak = calculateStreakDays(
      [event("2025-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")],
      new Date("2026-12-31T12:00:00.000Z"),
      "UTC",
    );

    expect(streak).toBe(MAX_STREAK_DAYS);
  });
});
