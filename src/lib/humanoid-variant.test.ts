import { describe, expect, it } from "vitest";

import {
  isHumanoidSelection,
  resolveHumanoidVariant,
} from "./humanoid-variant";

describe("resolveHumanoidVariant", () => {
  it.each([
    ["health", "athlete"],
    ["finance", "coins"],
    ["rest", "resting"],
    ["creativity", "creative"],
    ["growth", "creative"],
    ["career", "standing"],
    ["relationships", "standing"],
    ["environment", "standing"],
  ])("maps %s to %s", (categorySlug, variant) => {
    expect(resolveHumanoidVariant(categorySlug)).toBe(variant);
  });

  it("uses meditation when there is no weekly activity", () => {
    expect(resolveHumanoidVariant()).toBe("meditating");
    expect(resolveHumanoidVariant(null)).toBe("meditating");
  });

  it("uses the neutral pose for custom categories", () => {
    expect(resolveHumanoidVariant("custom-category")).toBe("standing");
  });
});

describe("isHumanoidSelection", () => {
  it("accepts automatic and manual options", () => {
    expect(isHumanoidSelection("auto")).toBe(true);
    expect(isHumanoidSelection("athlete")).toBe(true);
    expect(isHumanoidSelection("creative")).toBe(true);
  });

  it("rejects invalid persisted values", () => {
    expect(isHumanoidSelection("runner")).toBe(false);
    expect(isHumanoidSelection("")).toBe(false);
  });
});
