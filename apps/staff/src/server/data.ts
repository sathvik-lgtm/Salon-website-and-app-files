import {
  createAppointment,
  getAvailableSlots,
  listStylists,
  type CreateResult,
  type EngineOptions,
  type SlotsResult,
  type StylistsResult,
} from '@salon/booking';
import { createPrismaPort } from '@salon/booking/prisma';
import type { Db, Prisma } from '@salon/db';
import { DateTime } from 'luxon';
import { parseBranchHours, type BranchHours } from '@salon/db/hours';
import { generateTempPassword, hashPassword, verifyPassword } from '@salon/db/password';
import {
  appointmentScope,
  canChangeStatus,
  canCreateBooking,
  canManageTeam,
  canResetPassword,
  canSearchClients,
  canViewBranch,
  teamScope,
  type Actor,
  type TargetStatus,
} from './access';
import { checkNewPassword } from './password-policy';

/**
 * Everything the staff app reads or writes, scoped to WHO is asking.
 *
 * Rules that hold for every function here:
 *  - The actor comes from the server (the session, re-checked against the database), never from
 *    anything the browser sent.
 *  - Appointment queries always include `appointmentScope(actor)`, so the database never returns a
 *    row the person may not see.
 *  - Asking for something that exists but is out of scope gives the same NOT_FOUND as something that
 *    does not exist, so the app never confirms that a record exists.
 *  - `Customer.notes` is never selected (it is hidden in v0).
 */

export type NotFound = { ok: false; reason: 'NOT_FOUND' };
export type Forbidden = { ok: false; reason: 'FORBIDDEN' };
type Denied = NotFound | Forbidden;

const NOT_FOUND: NotFound = { ok: false, reason: 'NOT_FOUND' };
const FORBIDDEN: Forbidden = { ok: false, reason: 'FORBIDDEN' };

// ---------- who is signed in ----------

/** The signed-in person, as the DATABASE says they are right now (role, branch, still active). */
export async function loadActor(db: Db, staffId: string) {
  const s = await db.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      homeBranchId: true,
      active: true,
      mustChangePassword: true,
    },
  });
  if (!s || !s.active) return null;
  const actor: Actor = { id: s.id, name: s.name, role: s.role, homeBranchId: s.homeBranchId };
  return { actor, email: s.email, mustChangePassword: s.mustChangePassword };
}

// ---------- branches and the schedule ----------

export interface BranchInfo {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  phone: string;
  hours: BranchHours;
}

/** Branches the person may work with: all for an owner, otherwise their own. */
export async function listBranches(db: Db, actor: Actor): Promise<BranchInfo[]> {
  const rows = await db.branch.findMany({
    where: { active: true, ...(actor.role === 'OWNER' ? {} : { id: actor.homeBranchId }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, slug: true, name: true, timezone: true, phone: true, hours: true },
  });
  return rows.map((b) => ({ ...b, hours: parseBranchHours(b.hours) }));
}

export interface ScheduleAppointment {
  id: string;
  staffId: string;
  staffName: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  stylistPreference: string;
  customerName: string;
  /** Hidden from stylists: they need to know who is coming, not their number. */
  customerPhone: string | null;
  services: string[];
  totalPricePaise: number;
  createdAt: string;
}

export interface Schedule {
  branch: BranchInfo;
  stylists: { id: string; name: string }[];
  appointments: ScheduleAppointment[];
}

const appointmentListSelect = {
  id: true,
  staffId: true,
  startAt: true,
  endAt: true,
  status: true,
  source: true,
  stylistPreference: true,
  totalPricePaise: true,
  createdAt: true,
  staff: { select: { name: true } },
  // Name and phone only: `notes` is never read.
  customer: { select: { name: true, phone: true } },
  items: { select: { serviceName: true }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.AppointmentSelect;

/** Appointments of one branch overlapping [from, to), plus the columns (stylists) to show. */
export async function getSchedule(
  db: Db,
  actor: Actor,
  input: { branchId: string; from: Date; to: Date; stylistId?: string },
): Promise<({ ok: true } & Schedule) | Denied> {
  if (!canViewBranch(actor, input.branchId)) return FORBIDDEN;

  const [branch, bookable, rows] = await Promise.all([
    db.branch.findFirst({
      where: { id: input.branchId, active: true },
      select: { id: true, slug: true, name: true, timezone: true, phone: true, hours: true },
    }),
    db.staff.findMany({
      where: {
        homeBranchId: input.branchId,
        active: true,
        bookable: true,
        ...(actor.role === 'STYLIST' ? { id: actor.id } : {}),
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    db.appointment.findMany({
      where: {
        AND: [
          appointmentScope(actor),
          { branchId: input.branchId, startAt: { lt: input.to }, endAt: { gt: input.from } },
          ...(input.stylistId ? [{ staffId: input.stylistId }] : []),
        ],
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: appointmentListSelect,
    }),
  ]);
  if (!branch) return NOT_FOUND;

  const appointments: ScheduleAppointment[] = rows.map((a) => ({
    id: a.id,
    staffId: a.staffId,
    staffName: a.staff.name,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status,
    source: a.source,
    stylistPreference: a.stylistPreference,
    customerName: a.customer.name,
    customerPhone: actor.role === 'STYLIST' ? null : a.customer.phone,
    services: a.items.map((i) => i.serviceName),
    totalPricePaise: a.totalPricePaise,
    createdAt: a.createdAt.toISOString(),
  }));

  // A stylist who is no longer bookable still owns their past appointments: keep their column.
  const known = new Set(bookable.map((s) => s.id));
  const stylists = [...bookable];
  for (const a of appointments) {
    if (!known.has(a.staffId)) {
      known.add(a.staffId);
      stylists.push({ id: a.staffId, name: a.staffName });
    }
  }
  return {
    ok: true,
    branch: { ...branch, hours: parseBranchHours(branch.hours) },
    stylists: input.stylistId ? stylists.filter((s) => s.id === input.stylistId) : stylists,
    appointments,
  };
}

/**
 * The schedule for one calendar day, or the Monday-to-Sunday week containing it, read in the
 * BRANCH's timezone (a day at a branch starts at its own midnight, not the server's or the visitor's).
 */
export async function getScheduleForDate(
  db: Db,
  actor: Actor,
  input: { branchId: string; date: string; view: 'day' | 'week'; stylistId?: string },
): Promise<
  | ({ ok: true; range: { startDate: string; days: number } } & Schedule)
  | Denied
  | { ok: false; reason: 'INVALID_INPUT' }
> {
  if (!canViewBranch(actor, input.branchId)) return FORBIDDEN;
  const branch = await db.branch.findFirst({
    where: { id: input.branchId, active: true },
    select: { timezone: true },
  });
  if (!branch) return NOT_FOUND;

  const day = DateTime.fromISO(input.date, { zone: branch.timezone }).startOf('day');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.date) || !day.isValid) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }
  const days = input.view === 'week' ? 7 : 1;
  const start = input.view === 'week' ? day.minus({ days: day.weekday - 1 }) : day;
  const schedule = await getSchedule(db, actor, {
    branchId: input.branchId,
    from: start.toJSDate(),
    to: start.plus({ days }).toJSDate(),
    stylistId: input.stylistId,
  });
  if (!schedule.ok) return schedule;
  return { ...schedule, range: { startDate: start.toISODate()!, days } };
}

// ---------- one appointment ----------

export interface AppointmentDetail extends ScheduleAppointment {
  branch: { id: string; name: string; timezone: string; phone: string };
  totalDurationMin: number;
  items: { serviceName: string; pricePaise: number; durationMin: number }[];
  audit: { action: string; detail: unknown; at: string; actorName: string }[];
}

export async function getAppointment(
  db: Db,
  actor: Actor,
  id: string,
): Promise<{ ok: true; appointment: AppointmentDetail } | NotFound> {
  const a = await db.appointment.findFirst({
    where: { id, ...appointmentScope(actor) },
    select: {
      ...appointmentListSelect,
      totalDurationMin: true,
      branch: { select: { id: true, name: true, timezone: true, phone: true } },
      items: {
        select: { serviceName: true, pricePaise: true, durationMin: true },
        orderBy: { id: 'asc' },
      },
      audit: {
        select: { action: true, detail: true, createdAt: true, actor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
  if (!a) return NOT_FOUND;
  return {
    ok: true,
    appointment: {
      id: a.id,
      staffId: a.staffId,
      staffName: a.staff.name,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
      source: a.source,
      stylistPreference: a.stylistPreference,
      customerName: a.customer.name,
      customerPhone: actor.role === 'STYLIST' ? null : a.customer.phone,
      services: a.items.map((i) => i.serviceName),
      totalPricePaise: a.totalPricePaise,
      totalDurationMin: a.totalDurationMin,
      createdAt: a.createdAt.toISOString(),
      branch: a.branch,
      items: a.items,
      audit: a.audit.map((e) => ({
        action: e.action,
        detail: e.detail,
        at: e.createdAt.toISOString(),
        actorName: e.actor.name,
      })),
    },
  };
}

export type StatusChangeResult =
  | { ok: true; from: string; to: TargetStatus }
  | NotFound
  | { ok: false; reason: 'FORBIDDEN' | 'INVALID_TRANSITION' | 'CONFLICT' };

/**
 * Check in, complete, cancel or mark no-show. Cancelled and no-show appointments stop occupying
 * time automatically (the database's overlap rule ignores them), so the slot frees up at once.
 * The update only applies if the status is still what we read, so two people pressing different
 * buttons at the same moment cannot both win (the loser gets CONFLICT).
 */
export async function changeStatus(
  db: Db,
  actor: Actor,
  id: string,
  to: TargetStatus,
): Promise<StatusChangeResult> {
  const appointment = await db.appointment.findFirst({
    where: { id, ...appointmentScope(actor) },
    select: { id: true, branchId: true, staffId: true, status: true },
  });
  if (!appointment) return NOT_FOUND;

  const check = canChangeStatus(actor, appointment, to);
  if (!check.ok) return check;

  const applied = await db.$transaction(async (tx) => {
    const result = await tx.appointment.updateMany({
      where: { id, status: appointment.status },
      data: { status: to },
    });
    if (result.count === 0) return false;
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        appointmentId: id,
        action: 'STATUS_CHANGE',
        detail: { from: appointment.status, to },
      },
    });
    return true;
  });
  return applied ? { ok: true, from: appointment.status, to } : { ok: false, reason: 'CONFLICT' };
}

// ---------- booking at the desk ----------

export interface OfferedService {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  durationMin: number;
}

/** The services a branch offers, with the branch's own price and time, for the new-booking form. */
export async function listServices(
  db: Db,
  actor: Actor,
  branchId: string,
): Promise<{ ok: true; services: OfferedService[] } | Forbidden> {
  if (!canCreateBooking(actor, branchId)) return FORBIDDEN;
  const rows = await db.branchService.findMany({
    where: { branchId, available: true, service: { active: true } },
    select: {
      pricePaise: true,
      durationMin: true,
      service: {
        select: {
          id: true,
          name: true,
          basePricePaise: true,
          baseDurationMin: true,
          sortOrder: true,
          category: { select: { name: true, sortOrder: true } },
        },
      },
    },
  });
  rows.sort(
    (a, b) =>
      a.service.category.sortOrder - b.service.category.sortOrder ||
      a.service.sortOrder - b.service.sortOrder,
  );
  return {
    ok: true,
    services: rows.map((r) => ({
      id: r.service.id,
      name: r.service.name,
      category: r.service.category.name,
      pricePaise: r.pricePaise ?? r.service.basePricePaise,
      durationMin: r.durationMin ?? r.service.baseDurationMin,
    })),
  };
}

/** Stylists who can do ALL the chosen services at the branch. */
export async function getStylistChoices(
  db: Db,
  actor: Actor,
  input: { branchId: string; serviceIds: string[] },
  options?: EngineOptions,
): Promise<StylistsResult | Forbidden> {
  if (!canCreateBooking(actor, input.branchId)) return FORBIDDEN;
  return listStylists(createPrismaPort(db), input, options);
}

/** Free start times as the front desk sees them: no minimum notice, no window, from now. */
export async function getDeskSlots(
  db: Db,
  actor: Actor,
  input: { branchId: string; serviceIds: string[]; date: string; stylistId: string },
  options?: EngineOptions,
): Promise<SlotsResult | Forbidden> {
  if (!canCreateBooking(actor, input.branchId)) return FORBIDDEN;
  return getAvailableSlots(createPrismaPort(db), input, { ...options, forStaff: true });
}

/**
 * A walk-in or phone booking. It goes through the same engine as the website, so double booking is
 * impossible; `WALK_IN` and `PHONE` skip only the customer-facing rules (grid, notice, window, the
 * per-phone cap) and may use a landline.
 */
export async function createDeskBooking(
  db: Db,
  actor: Actor,
  input: {
    branchId: string;
    serviceIds: string[];
    startAt: Date;
    stylistId: string;
    name: string;
    phone: string;
    source: 'WALK_IN' | 'PHONE';
  },
  options?: EngineOptions,
): Promise<CreateResult | Forbidden> {
  if (!canCreateBooking(actor, input.branchId)) return FORBIDDEN;
  const result = await createAppointment(
    createPrismaPort(db),
    {
      branchId: input.branchId,
      serviceIds: input.serviceIds,
      startAt: input.startAt,
      stylistId: input.stylistId,
      customer: { name: input.name, phone: input.phone },
      source: input.source,
    },
    options,
  );
  if (result.ok) {
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        appointmentId: result.appointment.id,
        action: 'CREATE_BOOKING',
        detail: { source: input.source },
      },
    });
  }
  return result;
}

// ---------- clients ----------

export interface ClientSummary {
  id: string;
  name: string;
  phone: string;
  visits: number;
  lastVisit: string | null;
}

/** A customer is visible to the front desk if they have an appointment in scope (owners see all). */
const customerVisibility = (actor: Actor): Prisma.CustomerWhereInput =>
  actor.role === 'OWNER' ? {} : { appointments: { some: appointmentScope(actor) } };

/** Looks customers up by part of their phone number (at least 4 digits). */
export async function searchClients(
  db: Db,
  actor: Actor,
  query: string,
): Promise<{ ok: true; clients: ClientSummary[]; tooShort: boolean } | Forbidden> {
  if (!canSearchClients(actor)) return FORBIDDEN;
  // Customers are stored as +<country><number>: ignore spaces, dashes and a leading 0.
  const digits = query.replace(/\D/g, '').replace(/^0/, '');
  if (digits.length < 4) return { ok: true, clients: [], tooShort: true };

  const scope = appointmentScope(actor);
  const rows = await db.customer.findMany({
    where: { phone: { contains: digits }, ...customerVisibility(actor) },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 20,
    select: {
      id: true,
      name: true,
      phone: true,
      appointments: {
        where: scope,
        orderBy: { startAt: 'desc' },
        take: 1,
        select: { startAt: true },
      },
      _count: { select: { appointments: { where: scope } } },
    },
  });
  return {
    ok: true,
    tooShort: false,
    clients: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      visits: c._count.appointments,
      lastVisit: c.appointments[0]?.startAt.toISOString() ?? null,
    })),
  };
}

export interface ClientDetail {
  id: string;
  name: string;
  phone: string;
  history: {
    id: string;
    startAt: string;
    status: string;
    source: string;
    totalPricePaise: number;
    branchName: string;
    staffName: string;
    services: string[];
  }[];
}

/** One customer with their visit history, limited to the appointments the person may see. */
export async function getClient(
  db: Db,
  actor: Actor,
  id: string,
): Promise<{ ok: true; client: ClientDetail } | Denied> {
  if (!canSearchClients(actor)) return FORBIDDEN;
  const customer = await db.customer.findFirst({
    where: { id, ...customerVisibility(actor) },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) return NOT_FOUND;

  const history = await db.appointment.findMany({
    where: { customerId: id, ...appointmentScope(actor) },
    orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      startAt: true,
      status: true,
      source: true,
      totalPricePaise: true,
      branch: { select: { name: true } },
      staff: { select: { name: true } },
      items: { select: { serviceName: true }, orderBy: { id: 'asc' } },
    },
  });
  return {
    ok: true,
    client: {
      ...customer,
      history: history.map((h) => ({
        id: h.id,
        startAt: h.startAt.toISOString(),
        status: h.status,
        source: h.source,
        totalPricePaise: h.totalPricePaise,
        branchName: h.branch.name,
        staffName: h.staff.name,
        services: h.items.map((i) => i.serviceName),
      })),
    },
  };
}

// ---------- team and passwords ----------

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  branchName: string;
  active: boolean;
  mustChangePassword: boolean;
  canReset: boolean;
}

export async function listTeam(
  db: Db,
  actor: Actor,
): Promise<{ ok: true; team: TeamMember[] } | Forbidden> {
  if (!canManageTeam(actor)) return FORBIDDEN;
  const rows = await db.staff.findMany({
    where: teamScope(actor),
    orderBy: [{ homeBranchId: 'asc' }, { role: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      homeBranchId: true,
      active: true,
      mustChangePassword: true,
      homeBranch: { select: { name: true } },
    },
  });
  return {
    ok: true,
    team: rows.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      branchName: s.homeBranch.name,
      active: s.active,
      mustChangePassword: s.mustChangePassword,
      canReset: s.active && canResetPassword(actor, s),
    })),
  };
}

/**
 * Sets a one-time temporary password for a colleague (there is no email, so it is shown once to
 * the person resetting, who tells them). The colleague must change it at their next sign-in.
 */
export async function setTemporaryPassword(
  db: Db,
  actor: Actor,
  targetId: string,
): Promise<{ ok: true; password: string } | Denied> {
  if (!canManageTeam(actor)) return FORBIDDEN;
  const target = await db.staff.findFirst({
    where: { id: targetId, ...teamScope(actor) },
    select: { id: true, role: true, homeBranchId: true },
  });
  if (!target) return NOT_FOUND;
  if (!canResetPassword(actor, target)) return FORBIDDEN;

  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.staff.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true } }),
    db.auditLog.create({
      data: { actorId: actor.id, action: 'PASSWORD_RESET', detail: { targetStaffId: target.id } },
    }),
  ]);
  return { ok: true, password };
}

export type ChangePasswordResult =
  { ok: true } | { ok: false; reason: 'WRONG_PASSWORD' | 'WEAK_PASSWORD'; message?: string };

/** The signed-in person chooses a new password (also how a temporary one is replaced). */
export async function changeOwnPassword(
  db: Db,
  actor: Actor,
  input: { current: string; next: string },
): Promise<ChangePasswordResult> {
  const staff = await db.staff.findUnique({
    where: { id: actor.id },
    select: { email: true, passwordHash: true },
  });
  if (!staff || !(await verifyPassword(input.current, staff.passwordHash))) {
    return { ok: false, reason: 'WRONG_PASSWORD' };
  }
  const problem = checkNewPassword(input.next, { current: input.current, email: staff.email });
  if (problem) return { ok: false, reason: 'WEAK_PASSWORD', message: problem };

  const passwordHash = await hashPassword(input.next);
  await db.$transaction([
    db.staff.update({ where: { id: actor.id }, data: { passwordHash, mustChangePassword: false } }),
    db.auditLog.create({ data: { actorId: actor.id, action: 'PASSWORD_CHANGE' } }),
  ]);
  return { ok: true };
}
