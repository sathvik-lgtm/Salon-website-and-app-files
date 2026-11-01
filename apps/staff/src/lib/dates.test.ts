import { describe, expect, it } from 'vitest';
import {
  addDays,
  clockTime,
  formatMinutes,
  hhmmOf,
  isoWeekday,
  localDate,
  minutesIntoDay,
  openWindow,
  weekStart,
  zonedInstant,
  type WeekHours,
} from './dates';

describe('wall-clock time to an exact moment (zonedInstant)', () => {
  it('Kolkata is UTC+5:30 all year', () => {
    expect(zonedInstant('2026-11-09', '10:00', 'Asia/Kolkata')).toBe('2026-11-09T04:30:00.000Z');
    expect(zonedInstant('2026-06-09', '23:45', 'Asia/Kolkata')).toBe('2026-06-09T18:15:00.000Z');
    expect(zonedInstant('2026-11-09', '00:00', 'Asia/Kolkata')).toBe('2026-11-08T18:30:00.000Z'); // the day starts the evening before, in UTC
  });

  it('uses the right offset on either side of a daylight-saving change (New York, 1 Nov 2026)', () => {
    expect(zonedInstant('2026-10-31', '10:00', 'America/New_York')).toBe(
      '2026-10-31T14:00:00.000Z',
    ); // EDT, UTC-4
    expect(zonedInstant('2026-11-01', '10:00', 'America/New_York')).toBe(
      '2026-11-01T15:00:00.000Z',
    ); // EST, UTC-5
  });

  it('works for a zone ahead of UTC by more than a day-boundary (Auckland, UTC+13 in November)', () => {
    expect(zonedInstant('2026-11-10', '10:00', 'Pacific/Auckland')).toBe(
      '2026-11-09T21:00:00.000Z',
    );
  });

  it('round-trips with the reading helpers', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      const iso = zonedInstant('2026-11-09', '14:35', tz);
      expect(hhmmOf(new Date(iso), tz)).toBe('14:35');
      expect(localDate(new Date(iso), tz)).toBe('2026-11-09');
    }
  });
});

describe('dates in the branch timezone', () => {
  it('"today" is the branch-local date', () => {
    const at = new Date('2026-11-09T19:00:00Z'); // 00:30 on the 10th in Kolkata
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-11-10');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-11-09');
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-09', -9)).toBe('2026-10-31');
  });

  it('finds the weekday and the Monday of a week (Monday-first)', () => {
    expect(isoWeekday('2026-11-09')).toBe(1); // Monday
    expect(isoWeekday('2026-11-15')).toBe(7); // Sunday
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-12')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week that started the Monday before
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
  });

  it('reads opening hours for a date, and null when closed', () => {
    const std = { open: '10:00', close: '20:00' };
    const hours: WeekHours = {
      mon: null,
      tue: std,
      wed: std,
      thu: std,
      fri: std,
      sat: std,
      sun: { open: '11:00', close: '18:00' },
    };
    expect(openWindow(hours, '2026-11-09')).toBeNull(); // Monday closed
    expect(openWindow(hours, '2026-11-10')).toEqual({ open: 600, close: 1200 });
    expect(openWindow(hours, '2026-11-15')).toEqual({ open: 660, close: 1080 }); // Sunday
  });

  it('shows times on a 12-hour clock', () => {
    expect(formatMinutes(0)).toBe('12:00 am');
    expect(formatMinutes(605)).toBe('10:05 am');
    expect(formatMinutes(12 * 60 + 30)).toBe('12:30 pm');
    expect(formatMinutes(20 * 60)).toBe('8:00 pm');
    expect(clockTime('2026-11-09T04:30:00.000Z', 'Asia/Kolkata')).toBe('10:00 am');
    expect(minutesIntoDay('2026-11-09T04:30:00.000Z', 'Asia/Kolkata')).toBe(600);
  });
});
