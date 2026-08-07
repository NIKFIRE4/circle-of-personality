import { describe, expect, it } from "vitest";

import { createEventSchema, unsupportedExternalEventFields } from "./events";

describe("external calendar event mutations", () => {
  it("allows only local status and category changes", () => {
    expect(unsupportedExternalEventFields(["status", "categoryId"])).toEqual([]);
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
});
