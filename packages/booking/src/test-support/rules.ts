import type { BookingConfig } from '../config';

/**
 * The rule values the main engine tests were written against (30 min grid, 2 h notice, 60-day window,
 * 3 per phone). Pinned here so those tests keep checking the engine's logic however the live defaults
 * in `config.ts` are tuned. The live defaults are checked in `defaults.test.ts`.
 */
export const RULES: Partial<BookingConfig> = {
  slotGranularityMin: 30,
  minNoticeMin: 120,
  windowDays: 60,
  maxUpcomingPerPhone: 3,
};
