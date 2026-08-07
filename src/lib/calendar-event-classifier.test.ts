import { describe, expect, it, vi } from "vitest";

import {
  calendarClassificationUtcRange,
  classifyCalendarEventCandidates,
  type CalendarEventClassificationCandidate,
} from "./calendar-event-classifier";
import type { TaskAiConfig } from "./task-interpreter";

const AI_CONFIG: TaskAiConfig = {
  apiKey: "test-key",
  baseUrl: "https://provider.example/v1",
  model: "classifier-test",
  timeoutMs: 1_000,
};

const categories = [
  { id: "health-id", name: "Здоровье", slug: "health" },
  { id: "career-id", name: "Карьера", slug: "career" },
];

function event(
  id: string,
  title: string,
): CalendarEventClassificationCandidate {
  return {
    allDay: false,
    endAt: new Date("2026-08-07T10:00:00.000Z"),
    id,
    startAt: new Date("2026-08-07T09:00:00.000Z"),
    title,
  };
}

describe("classifyCalendarEventCandidates", () => {
  it("classifies the month as one AI batch and rejects hallucinated ids", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      model: "classifier/mock",
      choices: [{ message: { content: JSON.stringify({
        version: 1,
        classifications: [
          { eventId: "event-1", categoryId: "health-id" },
          { eventId: "event-2", categoryId: "invented-id" },
          { eventId: "invented-event", categoryId: "career-id" },
        ],
      }) } }],
    }));

    const result = await classifyCalendarEventCandidates({
      aiConfig: AI_CONFIG,
      categories,
      events: [event("event-1", "Приём врача"), event("event-2", "Без контекста")],
      fetchImpl: fetchMock,
      timeZone: "Europe/Moscow",
    });

    expect(result).toEqual({
      analyzed: 2,
      assignments: [{ eventId: "event-1", categoryId: "health-id" }],
      categorized: 1,
      mode: "ai",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const input = JSON.parse(body.messages[1].content);
    expect(input.events).toHaveLength(2);
    expect(input.categories).toEqual([
      { id: "health-id", name: "Здоровье" },
      { id: "career-id", name: "Карьера" },
    ]);
  });

  it("falls back to conservative local matching when AI is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("unavailable", { status: 500 }),
    );

    const result = await classifyCalendarEventCandidates({
      aiConfig: AI_CONFIG,
      categories,
      events: [event("event-1", "Тренировка в зале")],
      fetchImpl: fetchMock,
      timeZone: "Europe/Moscow",
    });

    expect(result).toMatchObject({
      assignments: [{ eventId: "event-1", categoryId: "health-id" }],
      categorized: 1,
      mode: "local",
    });
  });
});

describe("calendarClassificationUtcRange", () => {
  it("spans 30 days back and 14 forward from the local day", () => {
    // 22:30 UTC on 31 Aug is already 01:30 on 1 Sep in Moscow (UTC+3), so the
    // window is anchored to 1 Sep local midnight = 31 Aug 21:00 UTC.
    expect(calendarClassificationUtcRange(
      new Date("2026-08-31T22:30:00.000Z"),
      "Europe/Moscow",
    )).toEqual({
      start: new Date("2026-08-01T21:00:00.000Z"),
      end: new Date("2026-09-15T21:00:00.000Z"),
    });
  });

  it("covers the day before, which a calendar month boundary would miss", () => {
    const firstOfMonth = new Date("2026-09-01T09:00:00.000Z");
    const range = calendarClassificationUtcRange(firstOfMonth, "Europe/Moscow");
    const yesterday = new Date("2026-08-31T10:00:00.000Z");

    expect(range.start.getTime()).toBeLessThan(yesterday.getTime());
    expect(range.end.getTime()).toBeGreaterThan(firstOfMonth.getTime());
  });
});
