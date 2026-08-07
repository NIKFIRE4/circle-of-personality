import { describe, expect, it, vi } from "vitest";

import {
  calendarMonthUtcRange,
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

describe("calendarMonthUtcRange", () => {
  it("builds timezone-aware current-month boundaries", () => {
    expect(calendarMonthUtcRange(
      new Date("2026-08-31T22:30:00.000Z"),
      "Europe/Moscow",
    )).toEqual({
      start: new Date("2026-08-31T21:00:00.000Z"),
      end: new Date("2026-09-30T21:00:00.000Z"),
    });
  });
});
