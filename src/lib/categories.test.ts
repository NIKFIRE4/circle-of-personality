import { describe, expect, it } from "vitest";

import { createCategorySchema, slugifyCategoryName, updateCategorySchema } from "./categories";

describe("slugifyCategoryName", () => {
  it("creates a stable ASCII slug from a Russian name", () => {
    expect(slugifyCategoryName("Дом и быт")).toBe("dom-i-byt");
  });

  it("falls back for names without letters or digits", () => {
    expect(slugifyCategoryName("✨")).toBe("category");
  });
});

describe("category schemas", () => {
  it("accepts a valid weekly target", () => {
    const result = createCategorySchema.parse({ name: "Спорт", targetMinutesPerWeek: 180 });
    expect(result.color).toBe("#D8A84F");
    expect(result.targetMinutesPerWeek).toBe(180);
  });

  it("rejects invalid colors and empty patches", () => {
    expect(() => createCategorySchema.parse({ name: "Спорт", color: "orange" })).toThrow();
    expect(() => updateCategorySchema.parse({})).toThrow();
  });
});
