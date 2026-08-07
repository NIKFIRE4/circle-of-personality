import { describe, expect, it } from "vitest";
import {
  parseRussianVoiceCommand,
  VoiceCommandParseError,
} from "./voice-command";

describe("parseRussianVoiceCommand", () => {
  it("parses the internship example", () => {
    const result = parseRussianVoiceCommand("Поставь на эту пятницу задачу, с 13 до 17, танцы", new Date("2026-08-06T09:00:00+03:00"));
    expect(result.title).toBe("Танцы");
    expect(result.startAt).toContain("2026-08-07T10:00:00.000Z");
    expect(result.endAt).toContain("2026-08-07T14:00:00.000Z");
  });

  it("rolls an overnight event to the next day", () => {
    const result = parseRussianVoiceCommand("Добавь завтра с 22:30 до 1:00 отдых", new Date("2026-08-06T09:00:00+03:00"));
    expect(new Date(result.endAt).getTime()).toBeGreaterThan(new Date(result.startAt).getTime());
  });

  it("parses Russian number words produced by speech recognition", () => {
    const result = parseRussianVoiceCommand(
      "Поставь на эту пятницу задачу с тринадцати до семнадцати танцы",
      new Date("2026-08-06T09:00:00+03:00"),
    );

    expect(result.title).toBe("Танцы");
    expect(result.startAt).toBe("2026-08-07T10:00:00.000Z");
    expect(result.endAt).toBe("2026-08-07T14:00:00.000Z");
  });

  it("does not mistake a relative date after the time range for the title", () => {
    const result = parseRussianVoiceCommand(
      "С тренадцати до пятнадцати послезавтра",
      new Date("2026-08-07T09:00:00+03:00"),
    );

    expect(result.title).toBe("Новое событие");
    expect(result.startAt).toBe("2026-08-09T10:00:00.000Z");
    expect(result.endAt).toBe("2026-08-09T12:00:00.000Z");
  });

  it("parses compound hours and spoken minutes", () => {
    const result = parseRussianVoiceCommand(
      "Добавь завтра с двадцати одного тридцати до двадцати трёх сорока пяти чтение",
      new Date("2026-08-06T09:00:00+03:00"),
    );

    expect(result.title).toBe("Чтение");
    expect(result.startAt).toBe("2026-08-07T18:30:00.000Z");
    expect(result.endAt).toBe("2026-08-07T20:45:00.000Z");
  });

  it("returns a domain error suitable for a 422 response when time is missing", () => {
    expect.assertions(3);

    try {
      parseRussianVoiceCommand("Поставь на пятницу танцы");
    } catch (error) {
      expect(error).toBeInstanceOf(VoiceCommandParseError);
      expect(error).toMatchObject({ code: "VOICE_TIME_REQUIRED", status: 422 });
      expect((error as Error).message).toMatch(/время/i);
    }
  });

  it("returns a 422 domain error for an invalid spoken hour", () => {
    expect(() =>
      parseRussianVoiceCommand("Добавь завтра с двадцати пяти до двадцати шести сон"),
    ).toThrowError(
      expect.objectContaining({ code: "VOICE_TIME_INVALID", status: 422 }),
    );
  });
});
