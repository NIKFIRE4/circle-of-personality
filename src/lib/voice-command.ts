import { fromZonedTime, toZonedTime } from "date-fns-tz";

const weekdays: Record<string, number> = {
  воскресенье: 0, воскресенья: 0,
  понедельник: 1, понедельника: 1,
  вторник: 2, вторника: 2,
  среду: 3, среды: 3,
  четверг: 4, четверга: 4,
  пятницу: 5, пятницы: 5,
  субботу: 6, субботы: 6,
};

const russianNumberWords: Record<string, number> = {
  ноль: 0,
  нуль: 0,
  ноля: 0,
  нуля: 0,
  один: 1,
  одна: 1,
  одного: 1,
  одной: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трех: 3,
  трёх: 3,
  четыре: 4,
  четырех: 4,
  четырёх: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
  десять: 10,
  десяти: 10,
  одиннадцать: 11,
  одиннадцати: 11,
  двенадцать: 12,
  двенадцати: 12,
  тринадцать: 13,
  тринадцати: 13,
  тренадцать: 13,
  тренадцати: 13,
  четырнадцать: 14,
  четырнадцати: 14,
  пятнадцать: 15,
  пятнадцати: 15,
  шестнадцать: 16,
  шестнадцати: 16,
  семнадцать: 17,
  семнадцати: 17,
  восемнадцать: 18,
  восемнадцати: 18,
  девятнадцать: 19,
  девятнадцати: 19,
  двадцать: 20,
  двадцати: 20,
  тридцать: 30,
  тридцати: 30,
  сорок: 40,
  сорока: 40,
  пятьдесят: 50,
  пятидесяти: 50,
};

export type VoiceCommandParseErrorCode =
  | "VOICE_TIME_REQUIRED"
  | "VOICE_TIME_INVALID";

export class VoiceCommandParseError extends Error {
  readonly status = 422;

  constructor(
    readonly code: VoiceCommandParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VoiceCommandParseError";
  }
}

export type ParsedVoiceEvent = {
  title: string;
  startAt: string;
  endAt: string;
  confidence: number;
  needsConfirmation: boolean;
};

/** Conservative Russian parser. It never mutates data; the UI must confirm first. */
export function parseRussianVoiceCommand(transcript: string, now = new Date(), timeZone = "Europe/Moscow"): ParsedVoiceEvent {
  const normalized = normalizeRussianNumberWords(
    transcript
      .toLocaleLowerCase("ru-RU")
      .replace(/[,.!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const timeMatch = normalized.match(
    /(?:с|в)\s*(\d{1,2})(?:(?::|\s+)(\d{1,2})(?:\s+(\d))?)?\s*(?:час(?:а|ов|у)?\s*)?(?:до|[—–-])\s*(\d{1,2})(?:(?::|\s+)(\d{1,2})(?:\s+(\d))?)?(?:\s*час(?:а|ов)?)?/u,
  );
  if (!timeMatch) {
    throw new VoiceCommandParseError(
      "VOICE_TIME_REQUIRED",
      "Не удалось определить время. Скажите, например: «с тринадцати до семнадцати».",
    );
  }

  const startHour = Number(timeMatch[1]);
  const startMinute = parseMinute(timeMatch[2], timeMatch[3]);
  const endHour = Number(timeMatch[4]);
  const endMinute = parseMinute(timeMatch[5], timeMatch[6]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
    throw new VoiceCommandParseError(
      "VOICE_TIME_INVALID",
      "Время выходит за допустимый диапазон.",
    );
  }

  let target = toZonedTime(now, timeZone);
  let dateConfidence = .45;
  if (/послезавтра/u.test(normalized)) { target.setDate(target.getDate() + 2); dateConfidence = .94; }
  else if (/завтра/u.test(normalized)) { target.setDate(target.getDate() + 1); dateConfidence = .96; }
  else if (/сегодня/u.test(normalized)) { dateConfidence = .98; }
  else {
    const weekdayEntry = Object.entries(weekdays).find(([word]) => normalized.includes(word));
    if (weekdayEntry) {
      const wanted = weekdayEntry[1];
      let delta = (wanted - target.getDay() + 7) % 7;
      if (delta === 0 && (startHour < target.getHours() || /следующ/u.test(normalized))) delta = 7;
      if (/следующ/u.test(normalized) && delta < 7) delta += 7;
      target.setDate(target.getDate() + delta);
      dateConfidence = /эт[ауо]|ближайш/u.test(normalized) ? .95 : .86;
    } else {
      const numericDate = normalized.match(/(?:на\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/u);
      if (numericDate) {
        const year = numericDate[3] ? Number(numericDate[3].length === 2 ? `20${numericDate[3]}` : numericDate[3]) : target.getFullYear();
        target = new Date(year, Number(numericDate[2]) - 1, Number(numericDate[1]), 12);
        dateConfidence = .98;
      }
    }
  }

  const startLocal = new Date(target); startLocal.setHours(startHour, startMinute, 0, 0);
  const endLocal = new Date(target); endLocal.setHours(endHour, endMinute, 0, 0);
  if (endLocal <= startLocal) endLocal.setDate(endLocal.getDate() + 1);
  const start = fromZonedTime(startLocal, timeZone);
  const end = fromZonedTime(endLocal, timeZone);

  const afterTime = stripSchedulingWords(
    normalized
      .slice((timeMatch.index ?? 0) + timeMatch[0].length)
      .replace(/^[\s—,:-]+/u, ""),
  );
  let title = afterTime || stripSchedulingWords(normalized
    .replace(/^(пожалуйста\s+)?(поставь|добавь|создай|запланируй|запиши)\s*/u, "")
    .replace(/(?:^|\s)(мне\s+)?(задачу|событие|встречу|мероприятие)(?=\s|$)/gu, " ")
    .replace(timeMatch[0], "")
  );
  title = title.replace(/^(на|под названием|—|-)+\s*/u, "").trim();
  if (!title) title = "Новое событие";
  title = title.charAt(0).toLocaleUpperCase("ru-RU") + title.slice(1);

  const confidence = Math.round(((dateConfidence + .96 + (title === "Новое событие" ? .35 : .9)) / 3) * 100) / 100;
  return { title, startAt: start.toISOString(), endAt: end.toISOString(), confidence, needsConfirmation: confidence < .93 };
}

function normalizeRussianNumberWords(value: string): string {
  const tokens = value.split(" ");
  const normalized: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const current = russianNumberWords[tokens[index]];

    if (current === undefined) {
      normalized.push(tokens[index]);
      continue;
    }

    const next = russianNumberWords[tokens[index + 1]];
    if (
      current >= 20 &&
      current % 10 === 0 &&
      next !== undefined &&
      next > 0 &&
      next < 10
    ) {
      normalized.push(String(current + next));
      index += 1;
      continue;
    }

    normalized.push(String(current));
  }

  return normalized.join(" ");
}

function parseMinute(first: string | undefined, second: string | undefined): number {
  if (!first) return 0;
  return second ? Number(first) * 10 + Number(second) : Number(first);
}

function stripSchedulingWords(value: string): string {
  return value
    .replace(/(?:^|\s)(?:на\s+)?(?:эту|этот|это|следующую|следующий|ближайшую)?\s*(?:понедельник|понедельника|вторник|вторника|среду|среды|четверг|четверга|пятницу|пятницы|субботу|субботы|воскресенье|воскресенья|сегодня|завтра|послезавтра)(?=\s|$)/gu, " ")
    .replace(/(?:^|\s)(?:на\s+)?\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?=\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
