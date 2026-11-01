import type { Db } from '@salon/db';
import {
  SlotTakenError,
  type BookingPort,
  type BookingTx,
  type BusyInterval,
  type NewAppointment,
} from './types';

/** The slice of the Prisma client the port uses. Both `Db` and a transaction client fit. */
type Client = Pick<
  Db,
  '$executeRaw' | 'branch' | 'branchService' | 'staff' | 'timeOff' | 'appointment' | 'customer'
>;

const OCCUPYING_EXCLUDED = ['CANCELLED', 'NO_SHOW'] as const;
const CONSTRAINT_NAME = 'Appointment_no_staff_overlap';

/**
 * Error codes that mean "another booking got this stylist and time first":
 * - 23P01: the exclusion constraint refused an overlapping row.
 * - 40P01 / P2034: under heavy contention Postgres can instead abort one of several overlapping
 *   inserts as a deadlock victim (Prisma reports P2034). The only locks that can cycle here are on
 *   overlapping appointment rows, so the victim lost the same race and the winner holds the slot.
 */
const LOST_RACE_CODES = new Set(['23P01', '40P01', 'P2034']);

const isLostRaceMessage = (message: string) =>
  message.includes(CONSTRAINT_NAME) || message.includes('deadlock detected');

/**
 * Did this error come from losing a race for a slot? Prisma 7 wraps driver errors, and the code can
 * surface in different places, so look through the whole error chain.
 */
export function isLostRaceError(error: unknown, depth = 0, seen = new Set<unknown>()): boolean {
  if (depth > 6 || error === null || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  for (const value of Object.values(error)) {
    if (typeof value === 'string') {
      if (LOST_RACE_CODES.has(value) || isLostRaceMessage(value)) return true;
    } else if (isLostRaceError(value, depth + 1, seen)) {
      return true;
    }
  }
  const { message, cause } = error as { message?: unknown; cause?: unknown };
  if (typeof message === 'string' && isLostRaceMessage(message)) return true;
  return isLostRaceError(cause, depth + 1, seen);
}

function txStore(client: Client): BookingTx {
  return {
    async upsertCustomer({ name, phone, consentAt }) {
      const customer = await client.customer.upsert({
        where: { phone },
        create: { name, phone, consentAt },
        // Touching the row takes its lock. The existing name is deliberately left alone.
        update: { updatedAt: new Date(), ...(consentAt ? { consentAt } : {}) },
        // Never select `notes`: that field must not be read in v0.
        select: { id: true },
      });
      return customer.id;
    },

    countUpcoming(customerId, now) {
      return client.appointment.count({
        where: { customerId, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gt: now } },
      });
    },

    async insertAppointment(data: NewAppointment) {
      try {
        // Make racers for the same stylist take turns. Without this, several overlapping inserts wait
        // on each other and Postgres resolves the standoff as a deadlock only after `deadlock_timeout`
        // (1 s by default). Queued, the loser instead gets an immediate 23P01 once the winner commits.
        // This is only an optimisation: the exclusion constraint remains the final arbiter. The lock is
        // released automatically at commit/rollback. Customer rows are always locked before this, so
        // the lock order is fixed and cannot cycle.
        await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.staffId}))`;
        return await client.appointment.create({
          data: {
            branchId: data.branchId,
            staffId: data.staffId,
            customerId: data.customerId,
            startAt: data.startAt,
            endAt: data.endAt,
            status: data.status,
            source: data.source,
            stylistPreference: data.stylistPreference,
            totalPricePaise: data.totalPricePaise,
            totalDurationMin: data.totalDurationMin,
            manageTokenHash: data.manageTokenHash,
            items: { create: data.items },
          },
          select: { id: true },
        });
      } catch (error) {
        if (isLostRaceError(error)) throw new SlotTakenError();
        throw error;
      }
    },
  };
}

/** The booking engine's database port, backed by Prisma. Create the `Db` per request on Workers. */
export function createPrismaPort(db: Db): BookingPort {
  return {
    getBranch: (branchId) =>
      db.branch.findUnique({
        where: { id: branchId },
        select: { id: true, timezone: true, hours: true, active: true },
      }),

    async getServices(branchId, serviceIds) {
      const rows = await db.branchService.findMany({
        where: {
          branchId,
          serviceId: { in: serviceIds },
          available: true,
          service: { active: true },
        },
        select: {
          pricePaise: true,
          durationMin: true,
          service: {
            select: { id: true, name: true, basePricePaise: true, baseDurationMin: true },
          },
        },
      });
      return rows.map((r) => ({
        id: r.service.id,
        name: r.service.name,
        pricePaise: r.pricePaise ?? r.service.basePricePaise,
        durationMin: r.durationMin ?? r.service.baseDurationMin,
      }));
    },

    getCandidateStaff: (branchId, serviceIds, staffId) =>
      db.staff.findMany({
        where: {
          homeBranchId: branchId,
          active: true,
          bookable: true,
          ...(staffId ? { id: staffId } : {}),
          // Qualified for every selected service: one `some` per service.
          AND: serviceIds.map((serviceId) => ({ services: { some: { serviceId } } })),
        },
        select: {
          id: true,
          schedules: { select: { weekday: true, startMinute: true, endMinute: true } },
        },
        orderBy: { id: 'asc' },
      }),

    getTimeOff: (staffIds, from, to): Promise<BusyInterval[]> =>
      db.timeOff.findMany({
        where: { staffId: { in: staffIds }, startAt: { lt: to }, endAt: { gt: from } },
        select: { staffId: true, startAt: true, endAt: true },
      }),

    getBusy: (staffIds, from, to): Promise<BusyInterval[]> =>
      db.appointment.findMany({
        where: {
          staffId: { in: staffIds },
          status: { notIn: [...OCCUPYING_EXCLUDED] },
          startAt: { lt: to },
          endAt: { gt: from },
        },
        select: { staffId: true, startAt: true, endAt: true },
      }),

    async transaction(fn) {
      try {
        return await db.$transaction((tx) => fn(txStore(tx)));
      } catch (error) {
        // A deadlock victim can be reported by Prisma on commit or on any statement, not only the insert.
        if (isLostRaceError(error)) throw new SlotTakenError();
        throw error;
      }
    },
  };
}
