/**
 * Public types of the booking engine, including the `BookingPort` the database must implement.
 * Nothing here depends on Prisma, so the engine can be tested with an in-memory port.
 */

export type AppointmentSource = 'ONLINE' | 'WALK_IN' | 'PHONE';
export type StylistPreference = 'SPECIFIC' | 'ANY_AVAILABLE';

/** Why a request was refused. Stable strings: the apps map these to customer-facing messages. */
export type FailureReason =
  | 'INVALID_INPUT'
  | 'INVALID_PHONE'
  | 'BRANCH_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'STYLIST_NOT_ELIGIBLE'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'TOO_SOON'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_TAKEN'
  | 'PHONE_LIMIT_REACHED';

export interface Failure {
  ok: false;
  reason: FailureReason;
}

export interface SlotsInput {
  branchId: string;
  serviceIds: string[];
  /** Branch-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** A stylist id, or `'ANY'`. */
  stylistId: string;
}

export interface Slot {
  /** Branch-local start time, `HH:mm`. */
  time: string;
  /** The same moment as a UTC instant. Send this back to `createAppointment`. */
  startAt: Date;
}

export type SlotsResult = { ok: true; slots: Slot[] } | Failure;

export interface CreateInput {
  branchId: string;
  serviceIds: string[];
  startAt: Date;
  /** A stylist id, or `'ANY'`. */
  stylistId: string;
  customer: { name: string; phone: string };
  source: AppointmentSource;
  /** When the customer ticked the consent line (online bookings). */
  consentAt?: Date;
}

export interface CreatedAppointment {
  id: string;
  customerId: string;
  branchId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
  totalPricePaise: number;
  totalDurationMin: number;
  stylistPreference: StylistPreference;
  items: AppointmentItemSnapshot[];
}

export type CreateResult = { ok: true; appointment: CreatedAppointment } | Failure;

export interface AppointmentItemSnapshot {
  serviceId: string;
  serviceName: string;
  pricePaise: number;
  durationMin: number;
}

export interface EngineOptions {
  /** Defaults to the current time. Tests pass a fixed instant. */
  now?: Date;
  config?: Partial<import('./config').BookingConfig>;
}

// ---- Port: what the engine needs from the database ----

export interface BranchRecord {
  id: string;
  timezone: string;
  /** Raw `Branch.hours` JSON; the engine validates it with `branchHoursSchema`. */
  hours: unknown;
  active: boolean;
}

/** A service as offered at one branch, with the branch override (if any) already applied. */
export interface ServiceRecord {
  id: string;
  name: string;
  pricePaise: number;
  durationMin: number;
}

export interface ScheduleRow {
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** Minutes since branch-local midnight. */
  startMinute: number;
  endMinute: number;
}

export interface StaffRecord {
  id: string;
  schedules: ScheduleRow[];
}

/** A stretch of a stylist's time that is taken (time off or an existing appointment). */
export interface BusyInterval {
  staffId: string;
  startAt: Date;
  endAt: Date;
}

export interface NewAppointment {
  branchId: string;
  staffId: string;
  customerId: string;
  startAt: Date;
  endAt: Date;
  status: 'CONFIRMED';
  source: AppointmentSource;
  stylistPreference: StylistPreference;
  totalPricePaise: number;
  totalDurationMin: number;
  manageTokenHash: string;
  items: AppointmentItemSnapshot[];
}

/** Operations that run inside one database transaction. */
export interface BookingTx {
  /**
   * Find or create the customer by E.164 phone and return its id. Must NOT overwrite an existing
   * name, must never read `Customer.notes`, and should lock the row so concurrent bookings by the
   * same phone are counted one after another.
   */
  upsertCustomer(input: { name: string; phone: string; consentAt?: Date }): Promise<string>;
  /** Appointments of this customer that start after `now` and are PENDING or CONFIRMED. */
  countUpcoming(customerId: string, now: Date): Promise<number>;
  /** Insert the appointment and its items. Must throw `SlotTakenError` on SQLSTATE 23P01. */
  insertAppointment(data: NewAppointment): Promise<{ id: string }>;
}

export interface BookingPort {
  getBranch(branchId: string): Promise<BranchRecord | null>;
  /** Only services that are active and offered (`available`) at the branch. May be a subset. */
  getServices(branchId: string, serviceIds: string[]): Promise<ServiceRecord[]>;
  /**
   * Stylists who can take the whole block: active, bookable, home branch = `branchId`, qualified
   * for ALL `serviceIds`. When `staffId` is given, at most that one stylist.
   */
  getCandidateStaff(
    branchId: string,
    serviceIds: string[],
    staffId?: string,
  ): Promise<StaffRecord[]>;
  /** Time off overlapping [from, to). */
  getTimeOff(staffIds: string[], from: Date, to: Date): Promise<BusyInterval[]>;
  /** Appointments overlapping [from, to) that still occupy time (all but CANCELLED and NO_SHOW). */
  getBusy(staffIds: string[], from: Date, to: Date): Promise<BusyInterval[]>;
  /** Run `fn` in one transaction: commit if it returns, roll back if it throws. */
  transaction<T>(fn: (tx: BookingTx) => Promise<T>): Promise<T>;
}

/** Thrown by a port when the database refuses an overlapping appointment (SQLSTATE 23P01). */
export class SlotTakenError extends Error {
  constructor() {
    super('slot taken');
    this.name = 'SlotTakenError';
  }
}
