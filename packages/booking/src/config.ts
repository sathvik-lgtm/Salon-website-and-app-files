/**
 * Tunable booking rules. Change a number here and nothing else needs to move.
 * Values set by the owner on 2026-11-01 (the brief's defaults were 30 min grid, 120 min notice,
 * 60-day window, 3 per phone).
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
  slotGranularityMin: 15,
  bufferMin: 0,
  minNoticeMin: 60,
  windowDays: 7,
  maxUpcomingPerPhone: 2,
};

/** Defaults overlaid with per-call overrides (tests use this; apps normally pass nothing). */
export function resolveConfig(overrides?: Partial<BookingConfig>): BookingConfig {
  const config = { ...bookingConfig, ...overrides };
  if (!Number.isInteger(config.slotGranularityMin) || config.slotGranularityMin < 1) {
    throw new Error('slotGranularityMin must be a positive integer');
  }
  return config;
}
