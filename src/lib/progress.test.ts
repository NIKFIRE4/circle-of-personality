import { describe, expect, it } from "vitest";

import { calculateGoalProgress, clampPercentage } from "./progress";

describe("calculateGoalProgress", () => {
  it("calculates progress without rounding away precision", () => {
    expect(calculateGoalProgress(1, 3)).toBeCloseTo(33.3333, 3);
  });

  it("clamps completed and invalid goals", () => {
    expect(calculateGoalProgress(12, 10)).toBe(100);
    expect(calculateGoalProgress(-2, 10)).toBe(0);
    expect(calculateGoalProgress(5, 0)).toBe(0);
  });
});

describe("clampPercentage", () => {
  it("keeps percentages inside the display range", () => {
    expect(clampPercentage(-1)).toBe(0);
    expect(clampPercentage(42.5)).toBe(42.5);
    expect(clampPercentage(101)).toBe(100);
    expect(clampPercentage(Number.NaN)).toBe(0);
  });
});
