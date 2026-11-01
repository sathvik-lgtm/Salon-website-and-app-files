import { z } from 'zod';
import { listStarts } from './availability';
import { fail, loadContext, loadDay } from './context';
import { MS_PER_MIN, instantAt, isDateInWindow, localDateOf, parseLocalDate } from './time';
import type { BookingPort, EngineOptions, Slot, SlotsInput, SlotsResult } from './types';

export const MAX_SERVICES = 8;

export const serviceIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_SERVICES)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate service');

const slotsInputSchema = z.object({
  branchId: z.string().min(1),
  serviceIds: serviceIdsSchema,
  date: z.string(),
  stylistId: z.string().min(1),
});

/**
 * Start times (branch-local) at which the selected services can be booked on `date`.
 * For a specific stylist, that stylist's free starts; for `'ANY'`, every start where at least one
 * qualified stylist is free. Applies every online rule: opening hours, the stylist's schedule, time
 * off, existing bookings (plus buffer), minimum notice and the booking window.
 */
export async function getAvailableSlots(
  port: BookingPort,
  input: SlotsInput,
  options: EngineOptions = {},
): Promise<SlotsResult> {
  const parsed = slotsInputSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');
  const { branchId, serviceIds, date, stylistId } = parsed.data;

  const loaded = await loadContext(port, { branchId, serviceIds, stylistId }, options);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  const day = parseLocalDate(date, context.timezone);
  if (!day) return fail('INVALID_INPUT');
  const forStaff = options.forStaff === true;
  // Customers: today through the booking window. Staff: any date from today on.
  const dateOk = forStaff
    ? date >= localDateOf(context.now, context.timezone)
    : isDateInWindow(date, context.now, context.timezone, context.config.windowDays);
  if (!dateOk) return fail('OUTSIDE_BOOKING_WINDOW');

  const { plan, staffDays } = await loadDay(port, context, day, !forStaff);
  const starts = new Set<number>();
  for (const staff of staffDays) for (const m of listStarts(plan, staff)) starts.add(m);

  // Staff times start from now (the slot that contains this moment is still offered, for a walk-in).
  const earliestMs = context.now.getTime() - context.config.slotGranularityMin * MS_PER_MIN;
  const slots = [...starts]
    .sort((a, b) => a - b)
    .map<Slot>((m) => {
      const at = instantAt(day, m);
      return { time: at.toFormat('HH:mm'), startAt: at.toJSDate() };
    })
    .filter((slot) => !forStaff || slot.startAt.getTime() > earliestMs);
  return { ok: true, slots };
}
