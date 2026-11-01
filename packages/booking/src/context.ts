import { branchHoursSchema, hoursForWeekday, type BranchHours } from '@salon/db/hours';
import type { DateTime } from 'luxon';
import type { DayPlan, StaffDay } from './availability';
import { resolveConfig, type BookingConfig } from './config';
import { MS_PER_MIN, assertZone } from './time';
import type {
  BookingPort,
  EngineOptions,
  Failure,
  FailureReason,
  ServiceRecord,
  StaffRecord,
} from './types';

export const fail = (reason: FailureReason): Failure => ({ ok: false, reason });

/** Everything about the branch, services and candidate stylists, before any date is chosen. */
export interface BookingContext {
  branchId: string;
  timezone: string;
  hours: BranchHours;
  /** In the order the customer chose them. */
  services: ServiceRecord[];
  durationMin: number;
  totalPricePaise: number;
  candidates: StaffRecord[];
  config: BookingConfig;
  now: Date;
}

/**
 * Resolve the branch, the services (with branch overrides) and the stylists who could perform them
 * all. Fails with a typed reason when the request names something that cannot be booked.
 */
export async function loadContext(
  port: BookingPort,
  input: { branchId: string; serviceIds: string[]; stylistId: string },
  options: EngineOptions,
): Promise<{ ok: true; context: BookingContext } | Failure> {
  const branch = await port.getBranch(input.branchId);
  if (!branch || !branch.active) return fail('BRANCH_NOT_FOUND');
  assertZone(branch.timezone);

  const offered = await port.getServices(input.branchId, input.serviceIds);
  const byId = new Map(offered.map((s) => [s.id, s]));
  const services: ServiceRecord[] = [];
  for (const id of input.serviceIds) {
    const service = byId.get(id);
    if (!service) return fail('SERVICE_UNAVAILABLE');
    services.push(service);
  }

  const specific = input.stylistId !== 'ANY';
  const candidates = await port.getCandidateStaff(
    input.branchId,
    input.serviceIds,
    specific ? input.stylistId : undefined,
  );
  if (specific && candidates.length === 0) return fail('STYLIST_NOT_ELIGIBLE');

  return {
    ok: true,
    context: {
      branchId: branch.id,
      timezone: branch.timezone,
      // Corrupt hours JSON is a data bug, not user input: let it throw.
      hours: branchHoursSchema.parse(branch.hours),
      services,
      durationMin: services.reduce((sum, s) => sum + s.durationMin, 0),
      totalPricePaise: services.reduce((sum, s) => sum + s.pricePaise, 0),
      candidates,
      config: resolveConfig(options.config),
      now: options.now ?? new Date(),
    },
  };
}

/** The plan for one local day plus each candidate's time off and bookings for that day. */
export async function loadDay(
  port: BookingPort,
  context: BookingContext,
  day: DateTime,
  enforcePublicRules: boolean,
): Promise<{ plan: DayPlan; staffDays: StaffDay[] }> {
  const plan: DayPlan = {
    day,
    weekday: day.weekday,
    open: hoursForWeekday(context.hours, day.weekday),
    durationMin: context.durationMin,
    config: context.config,
    now: context.now,
    enforcePublicRules,
  };

  const ids = context.candidates.map((c) => c.id);
  if (ids.length === 0) return { plan, staffDays: [] };

  // Widen the window by the buffer so an appointment just outside the day still pads its edge.
  const padMs = context.config.bufferMin * MS_PER_MIN;
  const from = new Date(day.toMillis() - padMs);
  const to = new Date(day.plus({ days: 1 }).startOf('day').toMillis() + padMs);
  const [timeOff, busy] = await Promise.all([
    port.getTimeOff(ids, from, to),
    port.getBusy(ids, from, to),
  ]);

  const staffDays = context.candidates.map<StaffDay>((c) => ({
    staffId: c.id,
    schedules: c.schedules,
    timeOff: timeOff.filter((t) => t.staffId === c.id),
    busy: busy.filter((b) => b.staffId === c.id),
  }));
  return { plan, staffDays };
}
