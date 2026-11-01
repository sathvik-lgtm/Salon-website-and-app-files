import type { DateTime } from 'luxon';
import type { BookingConfig } from './config';
import type { BusyInterval, ScheduleRow } from './types';
import { MS_PER_MIN, instantAt } from './time';

/**
 * The availability rules, as pure functions over plain data. `getAvailableSlots` lists every start
 * time that passes `checkStart`; `createAppointment` runs the very same check on the requested
 * start, so what is offered and what is accepted can never disagree.
 */

/** What is being asked for on one branch-local day. */
export interface DayPlan {
  /** Local midnight of the requested date, in the branch timezone. */
  day: DateTime;
  /** ISO weekday of `day`. */
  weekday: number;
  /** The branch's open window that day (minutes since local midnight), or null if closed. */
  open: { openMinute: number; closeMinute: number } | null;
  /** Total length of the block: the sum of the selected services' durations. */
  durationMin: number;
  config: BookingConfig;
  now: Date;
  /**
   * Online bookings only: the start must sit on the slot grid and respect the minimum notice.
   * Staff (walk-in/phone) bookings may start at any minute and at any time, even right now.
   */
  enforcePublicRules: boolean;
}

/** One stylist's calendar for the day. */
export interface StaffDay {
  staffId: string;
  schedules: ScheduleRow[];
  timeOff: BusyInterval[];
  /** Existing appointments that still occupy time. */
  busy: BusyInterval[];
}

export type StartVerdict =
  'OK' | 'OFF_GRID' | 'TOO_SOON' | 'CLOSED' | 'NOT_WORKING' | 'TIME_OFF' | 'BOOKED';

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;

/** A stylist's working windows for the weekday, with touching or overlapping rows merged. */
function workingWindows(rows: ScheduleRow[], weekday: number): { start: number; end: number }[] {
  const sorted = rows
    .filter((r) => r.weekday === weekday)
    .map((r) => ({ start: r.startMinute, end: r.endMinute }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

/**
 * Can this stylist start the block at `startMinute` (minutes since local midnight)?
 * The block is [start, start + duration); the end of one booking may equal the start of the next.
 */
export function checkStart(plan: DayPlan, staff: StaffDay, startMinute: number): StartVerdict {
  const { config } = plan;
  const startMs = instantAt(plan.day, startMinute).toMillis();
  const endMs = startMs + plan.durationMin * MS_PER_MIN;

  if (plan.enforcePublicRules) {
    if (startMinute % config.slotGranularityMin !== 0) return 'OFF_GRID';
    if (startMs < plan.now.getTime() + config.minNoticeMin * MS_PER_MIN) return 'TOO_SOON';
  }

  // The whole block must sit inside the branch's opening hours...
  const { open } = plan;
  if (
    !open ||
    startMinute < open.openMinute ||
    endMs > instantAt(plan.day, open.closeMinute).toMillis()
  ) {
    return 'CLOSED';
  }

  // ...and inside one of the stylist's working windows (a break splits the day).
  const inShift = workingWindows(staff.schedules, plan.weekday).some(
    (w) => startMinute >= w.start && endMs <= instantAt(plan.day, w.end).toMillis(),
  );
  if (!inShift) return 'NOT_WORKING';

  if (staff.timeOff.some((t) => overlaps(startMs, endMs, t.startAt.getTime(), t.endAt.getTime()))) {
    return 'TIME_OFF';
  }

  // Existing appointments, padded by the buffer so there is a gap between clients.
  const bufferMs = config.bufferMin * MS_PER_MIN;
  const clash = staff.busy.some(
    (b) => startMs < b.endAt.getTime() + bufferMs && endMs + bufferMs > b.startAt.getTime(),
  );
  return clash ? 'BOOKED' : 'OK';
}

/** Every start minute on the slot grid that this stylist can take. */
export function listStarts(plan: DayPlan, staff: StaffDay): number[] {
  const starts: number[] = [];
  for (let m = 0; m < 1440; m += plan.config.slotGranularityMin) {
    if (checkStart(plan, staff, m) === 'OK') starts.push(m);
  }
  return starts;
}

/** How many appointments the stylist already has that start on this local day. */
export function bookingsOnDay(plan: DayPlan, staff: StaffDay): number {
  const from = plan.day.toMillis();
  const to = plan.day.plus({ days: 1 }).startOf('day').toMillis();
  return staff.busy.filter((b) => b.startAt.getTime() >= from && b.startAt.getTime() < to).length;
}
