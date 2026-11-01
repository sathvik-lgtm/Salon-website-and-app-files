/**
 * Tunable booking rules. These are the defaults agreed in the brief (still to be confirmed with the
 * owners). Change a number here and nothing else needs to move.
 */
export interface BookingConfig {
  /** Online slot start times are multiples of this many minutes after branch-local midnight. */
  slotGranularityMin: number;
  /** Minimum gap between two appointments of the same stylist. */
  bufferMin: number;
  /** An online booking must start at least this many minutes from now. */
  minNoticeMin: number;
  /** An online booking may be at most this many calendar days ahead (branch-local dates). */
  windowDays: number;
  /** Max upcoming confirmed online bookings per phone number. */
  maxUpcomingPerPhone: number;
}

export const bookingConfig: BookingConfig = {
  slotGranularityMin: 30,
  bufferMin: 0,
  minNoticeMin: 120,
  windowDays: 60,
  maxUpcomingPerPhone: 3,
};

/** Defaults overlaid with per-call overrides (tests use this; apps normally pass nothing). */
export function resolveConfig(overrides?: Partial<BookingConfig>): BookingConfig {
  const config = { ...bookingConfig, ...overrides };
  if (!Number.isInteger(config.slotGranularityMin) || config.slotGranularityMin < 1) {
    throw new Error('slotGranularityMin must be a positive integer');
  }
  return config;
}
