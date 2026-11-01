import {
  SlotTakenError,
  type AppointmentItemSnapshot,
  type BookingPort,
  type BusyInterval,
  type ScheduleRow,
} from '../types';

/** A tiny in-memory database for engine tests. It mimics the real port's rules and the overlap constraint. */

export interface MemBranch {
  id: string;
  timezone: string;
  hours: unknown;
  active?: boolean;
}
export interface MemService {
  id: string;
  name: string;
  basePricePaise: number;
  baseDurationMin: number;
  active?: boolean;
}
export interface MemBranchService {
  branchId: string;
  serviceId: string;
  available?: boolean;
  pricePaise?: number;
  durationMin?: number;
}
export interface MemStaff {
  id: string;
  name?: string;
  homeBranchId: string;
  serviceIds: string[];
  schedules: ScheduleRow[];
  active?: boolean;
  bookable?: boolean;
}
export interface MemAppointment {
  id: string;
  staffId: string;
  customerId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  source?: string;
  stylistPreference?: string;
  totalPricePaise?: number;
  totalDurationMin?: number;
  manageTokenHash?: string;
  items?: AppointmentItemSnapshot[];
}

export interface MemData {
  branches: MemBranch[];
  services: MemService[];
  branchServices: MemBranchService[];
  staff: MemStaff[];
  timeOff: BusyInterval[];
  appointments: MemAppointment[];
}

const FREE_STATUSES = ['CANCELLED', 'NO_SHOW'];

export function createMemoryPort(data: MemData, hooks: { failInsertFor?: string[] } = {}) {
  const customers = new Map<string, string>();
  let nextId = 1;
  const overlaps = (a: BusyInterval | MemAppointment, from: Date, to: Date) =>
    a.startAt < to && a.endAt > from;

  const port: BookingPort = {
    async getBranch(branchId) {
      const b = data.branches.find((x) => x.id === branchId);
      return b
        ? { id: b.id, timezone: b.timezone, hours: b.hours, active: b.active ?? true }
        : null;
    },

    async getServices(branchId, serviceIds) {
      const result = [];
      for (const id of serviceIds) {
        const bs = data.branchServices.find((x) => x.branchId === branchId && x.serviceId === id);
        const svc = data.services.find((x) => x.id === id);
        if (!bs || !svc || !(bs.available ?? true) || !(svc.active ?? true)) continue;
        result.push({
          id,
          name: svc.name,
          pricePaise: bs.pricePaise ?? svc.basePricePaise,
          durationMin: bs.durationMin ?? svc.baseDurationMin,
        });
      }
      return result;
    },

    async getCandidateStaff(branchId, serviceIds, staffId) {
      return data.staff
        .filter(
          (s) =>
            s.homeBranchId === branchId &&
            (s.active ?? true) &&
            (s.bookable ?? true) &&
            (!staffId || s.id === staffId) &&
            serviceIds.every((id) => s.serviceIds.includes(id)),
        )
        .map((s) => ({ id: s.id, name: s.name ?? `Stylist ${s.id}`, schedules: s.schedules }));
    },

    async getTimeOff(staffIds, from, to) {
      return data.timeOff.filter((t) => staffIds.includes(t.staffId) && overlaps(t, from, to));
    },

    async getBusy(staffIds, from, to) {
      return data.appointments.filter(
        (a) =>
          staffIds.includes(a.staffId) &&
          !FREE_STATUSES.includes(a.status) &&
          overlaps(a, from, to),
      );
    },

    transaction: (fn) =>
      fn({
        async upsertCustomer({ phone }) {
          if (!customers.has(phone)) customers.set(phone, `cust-${customers.size + 1}`);
          return customers.get(phone)!;
        },
        async countUpcoming(customerId, now) {
          return data.appointments.filter(
            (a) =>
              a.customerId === customerId &&
              ['PENDING', 'CONFIRMED'].includes(a.status) &&
              a.startAt > now,
          ).length;
        },
        async insertAppointment(a) {
          // Simulates losing the race to a concurrent booking.
          if (hooks.failInsertFor?.includes(a.staffId)) throw new SlotTakenError();
          const clash = data.appointments.some(
            (x) =>
              x.staffId === a.staffId &&
              !FREE_STATUSES.includes(x.status) &&
              overlaps(x, a.startAt, a.endAt),
          );
          if (clash) throw new SlotTakenError();
          const id = `appt-${nextId++}`;
          data.appointments.push({ id, ...a });
          return { id };
        },
      }),
  };
  return port;
}
