import { describe, expect, it } from "vitest";

import { assertTaskCommandRateLimit } from "./task-command-rate-limit";

describe("assertTaskCommandRateLimit", () => {
  it("limits a user to twenty smart-input requests per minute", () => {
    const userId = `rate-test-${crypto.randomUUID()}`;
    for (let index = 0; index < 20; index += 1) {
      expect(() => assertTaskCommandRateLimit(userId, 10_000)).not.toThrow();
    }

    expect(() => assertTaskCommandRateLimit(userId, 10_500)).toThrowError(
      expect.objectContaining({ status: 429, code: "TASK_COMMAND_RATE_LIMITED" }),
    );
  });

  it("starts a new bucket after the minute window", () => {
    const userId = `rate-reset-test-${crypto.randomUUID()}`;
    for (let index = 0; index < 20; index += 1) {
      assertTaskCommandRateLimit(userId, 50_000);
    }

    expect(() => assertTaskCommandRateLimit(userId, 110_000)).not.toThrow();
  });
});
