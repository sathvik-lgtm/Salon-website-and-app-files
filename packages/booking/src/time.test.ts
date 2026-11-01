import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { instantAt } from './time';

/** What instantAt must return, worked out directly with no caching. */
const direct = (day: DateTime, minute: number) =>
  minute >= 1440
    ? day.plus({ days: 1 }).startOf('day')
    : day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });

describe('instantAt', () => {
  const cases: [string, string][] = [
    ['Asia/Kolkata', '2026-11-04'],
    ['America/New_York', '2026-03-08'], // clocks go forward
    ['America/New_York', '2026-11-01'], // clocks go back
    ['Australia/Lord_Howe', '2026-10-04'], // half-hour daylight saving change
  ];

  for (const [zone, date] of cases) {
    it(`matches direct calculation all day in ${zone} on ${date}`, () => {
      const day = DateTime.fromISO(date, { zone }).startOf('day');
      for (let minute = 0; minute <= 1440; minute += 5) {
        expect(instantAt(day, minute).toMillis()).toBe(direct(day, minute).toMillis());
        // Asked again (now from the cache) it is still the same instant.
        expect(instantAt(day, minute).toMillis()).toBe(direct(day, minute).toMillis());
      }
    });
  }

  it('keeps separate answers for separate days', () => {
    const a = DateTime.fromISO('2026-11-04', { zone: 'Asia/Kolkata' }).startOf('day');
    const b = DateTime.fromISO('2026-11-05', { zone: 'Asia/Kolkata' }).startOf('day');
    expect(instantAt(b, 600).toMillis() - instantAt(a, 600).toMillis()).toBe(24 * 3_600_000);
  });
});
