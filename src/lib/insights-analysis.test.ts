import { describe, expect, it } from "vitest";

import { analyzeProgress, type ProgressAnalysisInput } from "./insights-analysis";
import type { BalanceMetric } from "./dashboard-math";

function metric(overrides: Partial<BalanceMetric> & { id: string }): BalanceMetric {
  return {
    color: "#d4a854",
    completedMinutes: 0,
    name: "Сфера",
    slug: "sphere",
    targetMinutes: 300,
    value: 0,
    ...overrides,
  };
}

const WEEK: ProgressAnalysisInput["weekDays"] = [
  { label: "пн", planned: true, value: 80 },
  { label: "вт", planned: true, value: 60 },
  { label: "ср", planned: false, value: 0 },
  { label: "чт", planned: true, value: 40 },
  { label: "пт", planned: false, value: 0 },
  { label: "сб", planned: false, value: 0 },
  { label: "вс", planned: false, value: 0 },
];

function input(overrides: Partial<ProgressAnalysisInput> = {}): ProgressAnalysisInput {
  return {
    change: 0,
    completedMinutes: 600,
    metrics: [],
    weekDays: WEEK,
    ...overrides,
  };
}

describe("analyzeProgress", () => {
  it("declines to judge a week with no weekly goals set", () => {
    const result = analyzeProgress(input({
      metrics: [metric({ id: "a", targetMinutes: 0 })],
    }));

    expect(result.hasEnoughData).toBe(false);
    expect(result.observations).toEqual([]);
    expect(result.suggestion).toBeNull();
  });

  it("declines to judge a week with almost no completed time", () => {
    const result = analyzeProgress(input({
      completedMinutes: 10,
      metrics: [metric({ id: "a", value: 3 })],
    }));

    expect(result.hasEnoughData).toBe(false);
    expect(result.suggestion).toBeNull();
  });

  it("puts what went well before what lagged", () => {
    const result = analyzeProgress(input({
      metrics: [
        metric({ id: "lag", name: "Творчество", completedMinutes: 60, value: 20 }),
        metric({ id: "win", name: "Здоровье", completedMinutes: 270, value: 90 }),
      ],
    }));

    const tones = result.observations.map((observation) => observation.tone);
    expect(tones.indexOf("strength")).toBeLessThan(tones.indexOf("lag"));
  });

  it("treats an untouched area as a possible choice, not a failure", () => {
    const result = analyzeProgress(input({
      metrics: [
        metric({ id: "win", name: "Здоровье", completedMinutes: 270, value: 90 }),
        metric({ id: "zero", name: "Финансы", completedMinutes: 0, value: 0 }),
      ],
    }));

    const untouched = result.observations.find((item) => item.tone === "untouched");
    expect(untouched?.detail).toContain("осознанный выбор");
  });

  it("anchors the suggestion to a day that has nothing planned", () => {
    const result = analyzeProgress(input({
      metrics: [
        metric({ id: "lag", name: "Творчество", completedMinutes: 60, value: 20 }),
      ],
    }));

    // Wednesday is the first free day in WEEK.
    expect(result.suggestion?.headline).toContain("среду");
    expect(result.suggestion?.headline).toContain("Творчество");
  });

  it("suggests a slice of the gap rather than the whole of it", () => {
    const result = analyzeProgress(input({
      metrics: [
        metric({
          id: "lag",
          name: "Творчество",
          completedMinutes: 0,
          targetMinutes: 600,
          value: 10,
        }),
      ],
    }));

    // Half of a 10h gap is 5h, which must still be capped to a 90 minute slot.
    expect(result.suggestion?.headline).toContain("1.5 ч");
  });

  it("explains a drop without attributing it to the person", () => {
    const result = analyzeProgress(input({
      change: -18,
      metrics: [metric({ id: "a", name: "Здоровье", completedMinutes: 270, value: 90 })],
    }));

    const trend = result.observations.find((item) => item.tone === "trend");
    expect(trend?.headline).toContain("18 п.п. меньше");
    expect(trend?.detail).toContain("без всякой связи с усилиями");
  });

  it("stays quiet about trends that are inside normal noise", () => {
    const result = analyzeProgress(input({
      change: 3,
      metrics: [metric({ id: "a", completedMinutes: 270, value: 90 })],
    }));

    expect(result.observations.some((item) => item.tone === "trend")).toBe(false);
  });

  it("caps how many lagging areas are shown at once", () => {
    const result = analyzeProgress(input({
      metrics: [
        metric({ id: "l1", name: "Один", completedMinutes: 30, value: 10 }),
        metric({ id: "l2", name: "Два", completedMinutes: 45, value: 15 }),
        metric({ id: "l3", name: "Три", completedMinutes: 60, value: 20 }),
        metric({ id: "l4", name: "Четыре", completedMinutes: 75, value: 25 }),
      ],
    }));

    expect(result.observations.filter((item) => item.tone === "lag")).toHaveLength(2);
  });
});
