/**
 * Who may see and do what. Pure rules, no database: every staff query and mutation asks these
 * first, and every list query also applies `appointmentScope` so the database itself never returns
 * rows the person may not see. The actor always comes from the SERVER (the session, re-checked
 * against the database on each request), never from anything the browser sends.
 *
 *   OWNER           every branch: view, book, change status, clients, team
 *   BRANCH_MANAGER  own branch: the same, plus the team of that branch
 *   RECEPTIONIST    own branch: view, book, change status, clients
 *   STYLIST         own appointments only, read-only (no clients, no booking, no changes)
 */
export type Role = 'OWNER' | 'BRANCH_MANAGER' | 'RECEPTIONIST' | 'STYLIST';
export type AppointmentStatus =
  'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Actor {
  id: string;
  name: string;
  role: Role;
  homeBranchId: string;
}

export interface AppointmentRef {
  branchId: string;
  staffId: string;
}

const isOwner = (a: Actor) => a.role === 'OWNER';
/** Roles that work the front desk: they may book and change appointments. */
const isFrontDesk = (a: Actor) => a.role !== 'STYLIST';

/** True if the actor may look at anything in this branch (a stylist still only sees their own). */
export function canViewBranch(actor: Actor, branchId: string): boolean {
  return isOwner(actor) || actor.homeBranchId === branchId;
}

/**
 * The database filter that limits appointments to what the actor may see. Use it as the base of
 * EVERY appointment query so out-of-scope rows are never fetched at all.
 */
export function appointmentScope(actor: Actor): { branchId?: string; staffId?: string } {
  if (isOwner(actor)) return {};
  if (actor.role === 'STYLIST') return { branchId: actor.homeBranchId, staffId: actor.id };
  return { branchId: actor.homeBranchId };
}

export function canViewAppointment(actor: Actor, appointment: AppointmentRef): boolean {
  if (isOwner(actor)) return true;
  if (appointment.branchId !== actor.homeBranchId) return false;
  return actor.role !== 'STYLIST' || appointment.staffId === actor.id;
}

export type TargetStatus = 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/** The moves an appointment may make from its current status. Finished appointments stay finished. */
export function allowedTransitions(from: AppointmentStatus): TargetStatus[] {
  switch (from) {
    case 'PENDING':
    case 'CONFIRMED':
      return ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'];
    case 'CHECKED_IN':
      return ['COMPLETED', 'CANCELLED'];
    default:
      return [];
  }
}

export type StatusChangeCheck =
  { ok: true } | { ok: false; reason: 'FORBIDDEN' | 'INVALID_TRANSITION' };

export function canChangeStatus(
  actor: Actor,
  appointment: AppointmentRef & { status: AppointmentStatus },
  to: TargetStatus,
): StatusChangeCheck {
  if (!isFrontDesk(actor) || !canViewAppointment(actor, appointment)) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  return allowedTransitions(appointment.status).includes(to)
    ? { ok: true }
    : { ok: false, reason: 'INVALID_TRANSITION' };
}

export function canCreateBooking(actor: Actor, branchId: string): boolean {
  return isFrontDesk(actor) && canViewBranch(actor, branchId);
}

export function canSearchClients(actor: Actor): boolean {
  return isFrontDesk(actor);
}

export function canManageTeam(actor: Actor): boolean {
  return actor.role === 'OWNER' || actor.role === 'BRANCH_MANAGER';
}

/**
 * Setting a temporary password for someone else. An owner may do it for anyone but themselves; a
 * branch manager only for the receptionists and stylists of their own branch (never another
 * manager or an owner, so a manager cannot take over a more powerful account).
 */
export function canResetPassword(
  actor: Actor,
  target: { id: string; role: Role; homeBranchId: string },
): boolean {
  if (target.id === actor.id) return false;
  if (isOwner(actor)) return true;
  if (actor.role !== 'BRANCH_MANAGER') return false;
  return (
    target.homeBranchId === actor.homeBranchId &&
    (target.role === 'RECEPTIONIST' || target.role === 'STYLIST')
  );
}

/** The staff the actor may see on the team page. */
export function teamScope(actor: Actor): { homeBranchId?: string } {
  return isOwner(actor) ? {} : { homeBranchId: actor.homeBranchId };
}
