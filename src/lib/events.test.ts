import { describe, expect, it } from "vitest";

import { createEventSchema, unsupportedExternalEventFields } from "./events";

describe("external calendar event mutations", () => {
  it("allows only local status, category and balance-wheel changes", () => {
    expect(unsupportedExternalEventFields(["status", "categoryId", "includeInBalance"])).toEqual([]);
    expect(unsupportedExternalEventFields(["title", "status", "startAt"])).toEqual(["title", "startAt"]);
  });
});

describe("createEventSchema", () => {
  it("does not accept a voice command id for a manual event", () => {
    expect(() => createEventSchema.parse({
      title: "Задача",
      startAt: "2026-08-06T10:00:00.000Z",
      endAt: "2026-08-06T11:00:00.000Z",
      source: "MANUAL",
      voiceCommandId: "command-id",
    })).toThrow();
  });

  it("defaults includeInBalance to true and accepts an explicit opt-out", () => {
    const base = {
      title: "Задача",
      startAt: "2026-08-06T10:00:00.000Z",
      endAt: "2026-08-06T11:00:00.000Z",
    };

    expect(createEventSchema.parse(base).includeInBalance).toBe(true);
    expect(createEventSchema.parse({ ...base, includeInBalance: false }).includeInBalance).toBe(false);
  });
});
