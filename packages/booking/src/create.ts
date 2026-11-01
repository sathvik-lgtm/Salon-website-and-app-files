import { DateTime } from 'luxon';
import { z } from 'zod';
import { bookingsOnDay, checkStart, type StartVerdict } from './availability';
import { fail, loadContext, loadDay } from './context';
import { normalizePhone } from './phone';
import { serviceIdsSchema } from './slots';
import { MS_PER_MIN, instantAt, isDateInWindow, wallMinute } from './time';
import { randomManageTokenHash } from './token';
import {
  SlotTakenError,
  type BookingPort,
  type CreateInput,
  type CreateResult,
  type EngineOptions,
  type Failure,
} from './types';

const createInputSchema = z.object({
  branchId: z.string().min(1),
  serviceIds: serviceIdsSchema,
  startAt: z.date().refine((d) => !Number.isNaN(d.getTime())),
  stylistId: z.string().min(1),
  customer: z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().min(1).max(32),
  }),
  source: z.enum(['ONLINE', 'WALK_IN', 'PHONE']),
  consentAt: z.date().optional(),
});

/** Turn the per-stylist verdicts for one start time into the single reason we report. */
function refusal(verdicts: StartVerdict[]): Failure {
  // Someone is working, free of time off, and just busy: the slot was there and is now taken.
  if (verdicts.includes('BOOKED')) return fail('SLOT_TAKEN');
  // These depend only on the time and the branch, so they are the same for every stylist.
  if (verdicts.includes('TOO_SOON') && verdicts.every((v) => v === 'TOO_SOON'))
    return fail('TOO_SOON');
  return fail('SLOT_UNAVAILABLE');
}

/**
 * Book an appointment. Everything is recomputed on the server: the services' price and duration
 * (with branch overrides), the end time, and the stylist for `'ANY'`. Callers send ids and a start
 * time only; there is no way to supply a price, duration or end time.
 *
 * The availability check here only gives nice errors. The Postgres exclusion constraint is the
 * final arbiter: a lost race surfaces as `SlotTakenError` from the port, and for `'ANY'` we then
 * try the next-best stylist. Each attempt is its own transaction, because Postgres aborts the
 * whole transaction once a statement fails.
 *
 * Online bookings obey every public rule (grid, notice, window, per-phone cap). Staff bookings
 * (walk-in, phone) skip those four but still need opening hours, the stylist's shift, no time off
 * and no overlap.
 */
export async function createAppointment(
  port: BookingPort,
  input: CreateInput,
  options: EngineOptions = {},
): Promise<CreateResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');
  const { branchId, serviceIds, stylistId, customer, source, consentAt } = parsed.data;
  const isOnline = source === 'ONLINE';

  const phone = normalizePhone(customer.phone, { requireMobile: isOnline });
  if (!phone) return fail('INVALID_PHONE');

  const loaded = await loadContext(port, { branchId, serviceIds, stylistId }, options);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  // Staff may book at any minute; online starts must be whole minutes (and on the grid, checked below).
  let startAt = parsed.data.startAt;
  if (startAt.getTime() % MS_PER_MIN !== 0) {
    if (isOnline) return fail('SLOT_UNAVAILABLE');
    startAt = new Date(Math.floor(startAt.getTime() / MS_PER_MIN) * MS_PER_MIN);
  }

  const local = DateTime.fromJSDate(startAt, { zone: context.timezone });
  const day = local.startOf('day');
  const startMinute = wallMinute(local);
  // Refuses the ambiguous repeated hour when clocks go back, rather than guessing which one.
  if (instantAt(day, startMinute).toMillis() !== startAt.getTime()) return fail('SLOT_UNAVAILABLE');

  if (
    isOnline &&
    !isDateInWindow(day.toISODate()!, context.now, context.timezone, context.config.windowDays)
  ) {
    return fail('OUTSIDE_BOOKING_WINDOW');
  }

  const { plan, staffDays } = await loadDay(port, context, day, isOnline);
  const verdicts = staffDays.map((s) => ({ staff: s, verdict: checkStart(plan, s, startMinute) }));
  const free = verdicts.filter((v) => v.verdict === 'OK').map((v) => v.staff);
  if (free.length === 0) return refusal(verdicts.map((v) => v.verdict));

  // 'ANY': fewest bookings that day first; ties broken by stylist id so the result is deterministic.
  const ranked = free
    .map((s) => ({ id: s.staffId, load: bookingsOnDay(plan, s) }))
    .sort((a, b) => a.load - b.load || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);

  const endAt = new Date(startAt.getTime() + context.durationMin * MS_PER_MIN);
  const stylistPreference = stylistId === 'ANY' ? 'ANY_AVAILABLE' : 'SPECIFIC';
  const items = context.services.map((s) => ({
    serviceId: s.id,
    serviceName: s.name,
    pricePaise: s.pricePaise,
    durationMin: s.durationMin,
  }));

  for (const staffId of ranked) {
    const manageTokenHash = await randomManageTokenHash();
    try {
      const outcome = await port.transaction(async (tx) => {
        // Upserting first locks an existing customer row, so two bookings by one phone are counted in turn.
        const customerId = await tx.upsertCustomer({ name: customer.name, phone, consentAt });
        if (
          isOnline &&
          (await tx.countUpcoming(customerId, context.now)) >= context.config.maxUpcomingPerPhone
        ) {
          return null;
        }
        const created = await tx.insertAppointment({
          branchId: context.branchId,
          staffId,
          customerId,
          startAt,
          endAt,
          status: 'CONFIRMED',
          source,
          stylistPreference,
          totalPricePaise: context.totalPricePaise,
          totalDurationMin: context.durationMin,
          manageTokenHash,
          items,
        });
        return { id: created.id, customerId };
      });
      if (!outcome) return fail('PHONE_LIMIT_REACHED');
      return {
        ok: true,
        appointment: {
          id: outcome.id,
          customerId: outcome.customerId,
          branchId: context.branchId,
          staffId,
          staffName: context.candidates.find((c) => c.id === staffId)?.name ?? '',
          startAt,
          endAt,
          totalPricePaise: context.totalPricePaise,
          totalDurationMin: context.durationMin,
          stylistPreference,
          items,
        },
      };
    } catch (error) {
      if (error instanceof SlotTakenError) continue; // lost the race for this stylist: try the next
      throw error;
    }
  }
  return fail('SLOT_TAKEN');
}
