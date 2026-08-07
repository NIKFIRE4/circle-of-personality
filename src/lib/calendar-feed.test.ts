import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CalendarFeedError,
  decryptCalendarFeedUrl,
  encryptCalendarFeedUrl,
  isPublicNetworkAddress,
  normalizeCalendarFeedUrl,
  parseCalendarFeed,
} from "./calendar-feed";

const TEST_ENCRYPTION_KEY = `base64:${Buffer.alloc(32, 7).toString("base64")}`;
let previousFeedKey: string | undefined;

beforeEach(() => {
  previousFeedKey = process.env.CALENDAR_FEED_ENCRYPTION_KEY;
  process.env.CALENDAR_FEED_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterEach(() => {
  if (previousFeedKey === undefined) {
    delete process.env.CALENDAR_FEED_ENCRYPTION_KEY;
  } else {
    process.env.CALENDAR_FEED_ENCRYPTION_KEY = previousFeedKey;
  }
});

describe("calendar feed URLs", () => {
  it("normalizes an Apple webcal subscription to HTTPS", () => {
    expect(
      normalizeCalendarFeedUrl(
        "webcal://p123-caldav.icloud.com/published/2/example-token",
      ),
    ).toEqual({
      provider: "APPLE",
      url: "https://p123-caldav.icloud.com/published/2/example-token",
    });
  });

  it("recognizes a Google secret iCal address", () => {
    expect(
      normalizeCalendarFeedUrl(
        "https://calendar.google.com/calendar/ical/user%40example.com/private-token/basic.ics",
      ).provider,
    ).toBe("GOOGLE");
  });

  it.each([
    "http://calendar.google.com/calendar/ical/example/basic.ics",
    "https://example.com/calendar.ics",
    "https://calendar.google.com/not-an-ical-page",
  ])("rejects an unsafe or unsupported URL: %s", (url) => {
    expect(() => normalizeCalendarFeedUrl(url)).toThrow(CalendarFeedError);
  });
});

describe("calendar feed secret storage", () => {
  it("encrypts the URL with authenticated encryption", () => {
    const url = "https://calendar.google.com/calendar/ical/example/private/basic.ics";
    const encrypted = encryptCalendarFeedUrl(url);
    const replacement = encrypted.endsWith("x") ? "y" : "x";
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;

    expect(encrypted).not.toContain("calendar.google.com");
    expect(decryptCalendarFeedUrl(encrypted)).toBe(url);
    expect(() => decryptCalendarFeedUrl(tampered)).toThrow(
      expect.objectContaining({ code: "calendar_feed_url_unreadable" }),
    );
  });
});

describe("calendar feed network policy", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.10.20",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicNetworkAddress(address)).toBe(true);
    },
  );

  it("allows the synthetic HTTPS egress range used by managed runtimes", () => {
    expect(isPublicNetworkAddress("198.18.0.20")).toBe(true);
  });
});

describe("calendar feed parsing", () => {
  it("imports timed, all-day and recurring events in a bounded window", async () => {
    const parsed = await parseCalendarFeed(
      `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Kontur Test//EN\r
X-WR-CALNAME:Личный календарь\r
BEGIN:VEVENT\r
UID:timed-1\r
DTSTAMP:20260807T000000Z\r
DTSTART;TZID=Europe/Moscow:20260808T100000\r
DTEND;TZID=Europe/Moscow:20260808T110000\r
SUMMARY:Встреча\r
LOCATION:Переговорная\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:all-day-1\r
DTSTAMP:20260807T000000Z\r
DTSTART;VALUE=DATE:20260809\r
DTEND;VALUE=DATE:20260810\r
SUMMARY:День без встреч\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:recurring-1\r
DTSTAMP:20260807T000000Z\r
DTSTART;TZID=Europe/Moscow:20260810T090000\r
DTEND;TZID=Europe/Moscow:20260810T093000\r
RRULE:FREQ=DAILY;COUNT=3\r
EXDATE;TZID=Europe/Moscow:20260811T090000\r
SUMMARY:Зарядка\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cancelled-1\r
DTSTAMP:20260807T000000Z\r
DTSTART:20260812T120000Z\r
DTEND:20260812T130000Z\r
STATUS:CANCELLED\r
SUMMARY:Отменено\r
END:VEVENT\r
END:VCALENDAR\r
`,
      "GOOGLE",
      "Europe/Moscow",
      new Date("2026-08-07T00:00:00.000Z"),
    );

    expect(parsed.displayName).toBe("Личный календарь");
    expect(parsed.events).toHaveLength(4);
    expect(parsed.events.filter((event) => event.title === "Зарядка")).toHaveLength(2);
    expect(parsed.events.some((event) => event.title === "Отменено")).toBe(false);

    const allDay = parsed.events.find((event) => event.title === "День без встреч");
    expect(allDay).toMatchObject({ allDay: true });
    expect(allDay?.startAt.toISOString()).toBe("2026-08-08T21:00:00.000Z");
    expect(allDay?.endAt.toISOString()).toBe("2026-08-09T21:00:00.000Z");
    expect(new Set(parsed.events.map((event) => event.externalId)).size).toBe(4);
  });

  it("rejects recurrence rules that could expand without a safe bound", async () => {
    await expect(
      parseCalendarFeed(
        `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Kontur Test//EN\r
BEGIN:VEVENT\r
UID:too-frequent\r
DTSTAMP:20260807T000000Z\r
DTSTART:20260807T000000Z\r
DTEND:20260807T000100Z\r
RRULE:FREQ=SECONDLY\r
SUMMARY:Too frequent\r
END:VEVENT\r
END:VCALENDAR\r
`,
        "APPLE",
        "UTC",
        new Date("2026-08-07T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "calendar_feed_recurrence_too_frequent" });
  });
});
