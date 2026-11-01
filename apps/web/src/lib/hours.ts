import type { BranchHours } from '@salon/db/hours';

/**
 * Opening-hours display and the "open now" state. Uses Intl (no date library) to keep the client
 * bundle small. Everything is read in the branch's own timezone, never the visitor's.
 */

const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** `"20:00"` -> `"8:00 pm"` */
export function formatTime(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${hhmm.slice(3)} ${suffix}`;
}

/** The branch-local ISO weekday (1 = Monday) and minutes since midnight at `now`. */
function localParts(timezone: string, now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: SHORT.indexOf(get('weekday')) + 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export interface OpenStatus {
  open: boolean;
  text: string;
}

export function openStatus(
  hours: BranchHours,
  timezone: string,
  now: Date = new Date(),
): OpenStatus {
  const { weekday, minutes } = localParts(timezone, now);
  const today = hours[KEYS[weekday - 1]!];
  if (today) {
    if (minutes >= minutesOf(today.open) && minutes < minutesOf(today.close)) {
      return { open: true, text: `Open now · closes ${formatTime(today.close)}` };
    }
    if (minutes < minutesOf(today.open)) {
      return { open: false, text: `Closed · opens today at ${formatTime(today.open)}` };
    }
  }
  for (let ahead = 1; ahead <= 7; ahead++) {
    const index = (weekday - 1 + ahead) % 7;
    const day = hours[KEYS[index]!];
    if (day) {
      const when = ahead === 1 ? 'tomorrow' : DAY_NAMES[index];
      return { open: false, text: `Closed · opens ${when} at ${formatTime(day.open)}` };
    }
  }
  return { open: false, text: 'Closed' };
}

/** One row per weekday for the hours table, Monday first. */
export function hoursRows(hours: BranchHours): { day: string; text: string }[] {
  return KEYS.map((key, i) => {
    const d = hours[key];
    return {
      day: DAY_NAMES[i]!,
      text: d ? `${formatTime(d.open)} – ${formatTime(d.close)}` : 'Closed',
    };
  });
}
