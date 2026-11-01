import { formatTime } from './hours';

/**
 * Date helpers for the booking flow. Everything is read in the BRANCH's timezone, never the
 * visitor's, and dates travel as `YYYY-MM-DD` strings (a calendar date, not a moment).
 */

/** Today's (or any instant's) calendar date in the branch timezone, as `YYYY-MM-DD`. */
export function localDate(at: Date, timezone: string): string {
  // The en-CA locale formats dates as year-month-day.
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

/** Today through today + `windowDays`, inclusive: every date a customer may book. */
export function windowDates(now: Date, timezone: string, windowDays: number): string[] {
  const today = localDate(now, timezone);
  return Array.from({ length: windowDays + 1 }, (_, i) => addDays(today, i));
}

/** Short labels for a date button: `{ weekday: 'Mon', day: '9 Nov' }`. */
export function dayLabel(date: string): { weekday: string; day: string } {
  const noon = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(noon),
    day: new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(noon),
  };
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

/** The branch-local `YYYY-MM-DD` and `HH:mm` of an ISO instant. */
export function localParts(iso: string, timezone: string): { date: string; time: string } {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: localDate(at, timezone), time: `${get('hour')}:${get('minute')}` };
}

/** "10:15 am" for an ISO instant, in the branch timezone. */
export function clockTime(iso: string, timezone: string): string {
  return formatTime(localParts(iso, timezone).time);
}

/** "Monday, 9 November 2026 at 10:15 am" for an ISO instant, in the branch timezone. */
export function dateAndTime(iso: string, timezone: string): string {
  const { date } = localParts(iso, timezone);
  return `${longDate(date)} at ${clockTime(iso, timezone)}`;
}

/** Groups `HH:mm` times by hour, in order: `[{ hour: 10, label: '10 am', times: ['10:00', ...] }]`. */
export function groupByHour(times: string[]): { hour: number; label: string; times: string[] }[] {
  const groups = new Map<number, string[]>();
  for (const t of times) {
    const hour = Number(t.slice(0, 2));
    groups.set(hour, [...(groups.get(hour) ?? []), t]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, list]) => ({
      hour,
      label: `${hour % 12 === 0 ? 12 : hour % 12} ${hour >= 12 ? 'pm' : 'am'}`,
      times: list,
    }));
}
