import { describe, expect, it } from "vitest";

import { createGoalSchema, currentWeekBounds } from "./goals";

describe("currentWeekBounds", () => {
  it("uses Monday in the user's time zone", () => {
    const bounds = currentWeekBounds("Europe/Moscow", new Date("2026-08-05T12:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-08-02T21:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-08-09T21:00:00.000Z");
  });
});

describe("createGoalSchema", () => {
  it("accepts weekly habits and one-off milestones", () => {
    const result = createGoalSchema.safeParse({
      title: "Стать выносливее",
      targetValue: 1,
      tasks: [
        { title: "Пробежка", kind: "HABIT", targetPerWeek: 3, durationMinutes: 20, status: "ACTIVE" },
        { title: "Пробежать первые 5 км", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 40, status: "ACTIVE" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a repeating task without a weekly target", () => {
    const result = createGoalSchema.safeParse({
      title: "Регулярно двигаться",
      targetValue: 1,
      tasks: [{ title: "Тренировка", kind: "HABIT", targetPerWeek: null, durationMinutes: 30, status: "ACTIVE" }],
    });
    expect(result.success).toBe(false);
  });
});
