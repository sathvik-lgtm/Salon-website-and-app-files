import type { TargetStatus } from '../server/access';

/** How each status reads and looks. Never colour alone: every status also has its words. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

/** Statuses that no longer occupy the stylist's time (the database ignores them for overlaps). */
export const INACTIVE_STATUSES = ['CANCELLED', 'NO_SHOW'];

export const STATUS_STYLE: Record<string, string> = {
  PENDING: 'border-l-4 border-accent bg-surface',
  CONFIRMED: 'border-l-4 border-accent bg-accent-soft',
  CHECKED_IN: 'border-l-4 border-ink bg-accent text-accent-ink',
  COMPLETED: 'border-l-4 border-stone-500 bg-stone-200 text-ink',
  CANCELLED: 'border border-dashed border-stone-500 bg-surface text-muted line-through',
  NO_SHOW: 'border border-dashed border-stone-500 bg-surface text-muted line-through',
};

/** The same statuses as small round badges (no left edge, which belongs to the calendar blocks). */
export const STATUS_BADGE: Record<string, string> = {
  PENDING: 'border border-line bg-surface',
  CONFIRMED: 'bg-accent-soft text-ink',
  CHECKED_IN: 'bg-accent text-accent-ink',
  COMPLETED: 'bg-stone-200 text-ink',
  CANCELLED: 'border border-dashed border-stone-500 text-muted line-through',
  NO_SHOW: 'border border-dashed border-stone-500 text-muted line-through',
};

export const ACTION_LABEL: Record<TargetStatus, string> = {
  CHECKED_IN: 'Check in',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel booking',
  NO_SHOW: 'Mark no-show',
};

/** The actions that need a "are you sure?" step because they cannot be undone. */
export const NEEDS_CONFIRMATION: TargetStatus[] = ['CANCELLED', 'NO_SHOW'];
