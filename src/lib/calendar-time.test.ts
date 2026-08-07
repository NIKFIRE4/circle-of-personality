import { describe, expect, it } from "vitest";

import { fullCalendarMarkerToUtc, toFullCalendarInput, zonedInputToIso } from "./calendar-time";

describe("calendar timezone helpers", () => {
  it("renders an instant as a wall-clock value in the user timezone", () => {
    expect(toFullCalendarInput("2026-08-06T10:00:00.000Z", "Europe/Moscow", false)).toBe("2026-08-06T13:00:00");
  });

  it("converts UTC-coerced FullCalendar callbacks back to an instant", () => {
    const marker = new Date("2026-08-03T00:00:00.000Z");
    expect(fullCalendarMarkerToUtc(marker, "Europe/Moscow").toISOString()).toBe("2026-08-02T21:00:00.000Z");
  });

  it("converts datetime-local values with the same timezone contract", () => {
    expect(zonedInputToIso("2026-08-06T13:00", "Europe/Moscow")).toBe("2026-08-06T10:00:00.000Z");
  });
});
