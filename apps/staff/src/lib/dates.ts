/**
 * Dates for the staff screens. Everything is read in the BRANCH's timezone, never the browser's:
 * a front desk laptop set to another timezone must still show the salon's own day.
 */

const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof KEYS)[number];

export interface DayHours {
  open: string;
  close: string;
}
export type WeekHours = Record<DayKey, DayHours | null>;

/** The branch-local `YYYY-MM-DD` of an instant. */
export function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `2026-11-09` plus `days` calendar days (negative allowed). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday) of a `YYYY-MM-DD` date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** The branch's opening window on a date, as minutes after midnight, or null when closed. */
export function openWindow(hours: WeekHours, date: string): { open: number; close: number } | null {
  const day = hours[KEYS[isoWeekday(date) - 1]!];
  if (!day) return null;
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  return { open: minutes(day.open), close: minutes(day.close) };
}

/** Branch-local minutes after midnight of an instant. */
export function minutesIntoDay(iso: string | Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** `600` -> `10:00 am` */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

/** `10:15 am` for an instant, in the branch timezone. */
export function clockTime(iso: string | Date, timezone: string): string {
  return formatMinutes(minutesIntoDay(iso, timezone));
}

/** "Mon 9 Nov" for a `YYYY-MM-DD` date. */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Monday, 9 November 2026" for a `YYYY-MM-DD` date. */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Mon 9 Nov, 10:15 am" for an instant, in the branch timezone. */
export function dateAndTime(iso: string, timezone: string): string {
  return `${shortDate(localDate(new Date(iso), timezone))}, ${clockTime(iso, timezone)}`;
}

/** How far ahead of UTC a timezone is at a given instant, in milliseconds (IST is +5.5 hours). */
function offsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The exact moment (ISO, UTC) of a wall-clock time in a timezone: 10:00 on 9 Nov at the branch.
 * Handles daylight-saving changes (the offset is looked up at the moment itself, not guessed).
 */
export function zonedInstant(date: string, hhmm: string, timezone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = hhmm.split(':').map(Number) as [number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, h, min);
  // First guess with the offset at the wall time read as UTC, then correct it with the offset at the result.
  let instant = wallAsUtc - offsetMs(new Date(wallAsUtc), timezone);
  instant = wallAsUtc - offsetMs(new Date(instant), timezone);
  return new Date(instant).toISOString();
}

/** The branch-local `HH:mm` of an instant, to the minute. */
export function hhmmOf(at: Date, timezone: string): string {
  const minutes = minutesIntoDay(at, timezone);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
