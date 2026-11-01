import { DateTime, IANAZone } from 'luxon';

export const MS_PER_MIN = 60_000;

/** Throws on an invalid timezone: that is bad data, not bad user input. */
export function assertZone(timezone: string): void {
  if (!IANAZone.isValidZone(timezone)) throw new Error(`Invalid branch timezone: ${timezone}`);
}

/** Local midnight of a `YYYY-MM-DD` date in the branch zone, or null if it is not a real date. */
export function parseLocalDate(date: string, timezone: string): DateTime | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = DateTime.fromISO(date, { zone: timezone });
  return day.isValid ? day.startOf('day') : null;
}

/**
 * The instant at `minute` minutes of wall-clock time after local midnight of `day`.
 * 1440 (end of day) means the next local midnight.
 */
export function instantAt(day: DateTime, minute: number): DateTime {
  let byMinute = instantCache.get(day);
  if (!byMinute) instantCache.set(day, (byMinute = new Map()));
  let at = byMinute.get(minute);
  if (!at) byMinute.set(minute, (at = computeInstantAt(day, minute)));
  return at;
}

// Working out a wall-clock time in a named zone is slow (Luxon asks Intl for the zone's offset), and
// one availability request asks for the same few hundred times over and over (every stylist, every
// start, every opening-hours check). DateTime values never change, so the answers are kept for as
// long as the `day` object they were asked about lives (one request).
const instantCache = new WeakMap<DateTime, Map<number, DateTime>>();

function computeInstantAt(day: DateTime, minute: number): DateTime {
  if (minute >= 1440) return day.plus({ days: 1 }).startOf('day');
  return day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
}

/** Wall-clock minutes after local midnight (what schedules and branch hours are expressed in). */
export function wallMinute(local: DateTime): number {
  return local.hour * 60 + local.minute;
}

/** Whether `dateIso` is today or later, and at most `windowDays` days after today, in the branch zone. */
export function isDateInWindow(
  dateIso: string,
  now: Date,
  timezone: string,
  windowDays: number,
): boolean {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const last = today.plus({ days: windowDays }).toISODate();
  const first = today.toISODate();
  // ISO dates sort the same as calendar dates.
  return dateIso >= first! && dateIso <= last!;
}

/** The branch-local calendar date (`YYYY-MM-DD`) of an instant. */
export function localDateOf(at: Date, timezone: string): string {
  return DateTime.fromJSDate(at, { zone: timezone }).toISODate()!;
}
