import { fromZonedTime, toZonedTime } from "date-fns-tz";

export function toZonedInputValue(value: Date | string, timeZone: string, allDay: boolean) {
  const local = toZonedTime(typeof value === "string" ? new Date(value) : value, timeZone);
  const date = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
  if (allDay) return date;
  return `${date}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
}

export function toFullCalendarInput(value: Date | string, timeZone: string, allDay: boolean) {
  const local = toZonedInputValue(value, timeZone, allDay);
  return allDay ? local : `${local}:00`;
}

/**
 * FullCalendar uses UTC-coercion for named zones when no timezone plugin is
 * installed. Callback Date objects therefore contain wall-clock fields in
 * their UTC accessors. Interpret those fields in the user's IANA zone.
 */
export function fullCalendarMarkerToUtc(value: Date, timeZone: string) {
  const wallClock = [
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`,
  ].join("T");
  return fromZonedTime(wallClock, timeZone);
}

export function zonedInputToIso(value: string, timeZone: string) {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).toISOString();
  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  return fromZonedTime(normalized, timeZone).toISOString();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
