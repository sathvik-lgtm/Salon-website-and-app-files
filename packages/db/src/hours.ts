import { z } from 'zod';

/**
 * Branch.hours JSON shape (branch-local time, 24h "HH:mm"). A day is either an open interval or null (closed):
 *   { "mon": { "open": "10:00", "close": "20:00" }, "tue": null, ... "sun": { "open": "11:00", "close": "18:00" } }
 * Every weekday key is required so a missing day is never silently treated as open.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24h)');

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const openDay = z
  .object({ open: hhmm, close: hhmm })
  .refine((d) => toMinutes(d.close) > toMinutes(d.open), { message: 'close must be after open' });

const day = openDay.nullable();

export const branchHoursSchema = z.object({
  mon: day,
  tue: day,
  wed: day,
  thu: day,
  fri: day,
  sat: day,
  sun: day,
});

export type BranchHours = z.infer<typeof branchHoursSchema>;
export type WeekdayKey = keyof BranchHours;

/** ISO weekday (1 = Monday ... 7 = Sunday) to hours key. */
export const WEEKDAY_KEYS: readonly WeekdayKey[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export function parseBranchHours(input: unknown): BranchHours {
  return branchHoursSchema.parse(input);
}

/** Open window for an ISO weekday as minutes since local midnight, or null if closed. */
export function hoursForWeekday(
  hours: BranchHours,
  isoWeekday: number,
): { openMinute: number; closeMinute: number } | null {
  const key = WEEKDAY_KEYS[isoWeekday - 1];
  const d = key ? hours[key] : null;
  return d ? { openMinute: toMinutes(d.open), closeMinute: toMinutes(d.close) } : null;
}
