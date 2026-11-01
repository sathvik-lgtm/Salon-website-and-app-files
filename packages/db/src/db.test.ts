import { describe, expect, it } from 'vitest';
import { branchHoursSchema, hoursForWeekday } from './hours';
import { generateTempPassword, hashPassword, verifyPassword } from './password';

const std = { open: '10:00', close: '20:00' };
const week = { mon: std, tue: std, wed: std, thu: std, fri: std, sat: std, sun: null };

describe('branchHoursSchema', () => {
  it('accepts a valid week with a closed day', () => {
    expect(branchHoursSchema.safeParse(week).success).toBe(true);
  });
  it('rejects a missing weekday, bad time, and close <= open', () => {
    const { sun: _sun, ...missing } = week;
    expect(branchHoursSchema.safeParse(missing).success).toBe(false);
    expect(branchHoursSchema.safeParse({ ...week, mon: { open: '9am', close: '20:00' } }).success).toBe(false);
    expect(branchHoursSchema.safeParse({ ...week, mon: { open: '20:00', close: '10:00' } }).success).toBe(false);
  });
  it('maps ISO weekday to minutes, null when closed', () => {
    const h = branchHoursSchema.parse(week);
    expect(hoursForWeekday(h, 1)).toEqual({ openMinute: 600, closeMinute: 1200 });
    expect(hoursForWeekday(h, 7)).toBeNull();
  });
});

describe('password', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('generates distinct temp passwords', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
