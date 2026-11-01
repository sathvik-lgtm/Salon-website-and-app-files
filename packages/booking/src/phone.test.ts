import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('writes the same Indian mobile number in any common format as one E.164 string', () => {
    for (const written of [
      '9876543210',
      '98765 43210',
      '09876543210',
      '+919876543210',
      '+91 98765-43210',
      '(+91) 98765 43210',
    ]) {
      expect(normalizePhone(written), written).toBe('+919876543210');
    }
  });

  it('rejects numbers that cannot exist or are too short', () => {
    for (const bad of ['', '12345', '0000000000', '5555555555', 'abcdefghij', '98765', '+91']) {
      expect(normalizePhone(bad), bad).toBeNull();
    }
  });

  it('accepts international mobiles written with their country code', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  describe('requireMobile (online bookings)', () => {
    it('refuses landline-shaped numbers, including 1234567890, which is a valid fixed line', () => {
      expect(normalizePhone('1234567890')).toBe('+911234567890'); // valid as a landline...
      expect(normalizePhone('1234567890', { requireMobile: true })).toBeNull(); // ...but not reachable by mobile
      expect(normalizePhone('080 2345 6789', { requireMobile: true })).toBeNull(); // a Bengaluru landline
      expect(normalizePhone('080 2345 6789')).toBe('+918023456789'); // fine when staff enter it
    });

    it('still accepts real mobiles, in India and abroad', () => {
      expect(normalizePhone('98765 43210', { requireMobile: true })).toBe('+919876543210');
      expect(normalizePhone('+447911123456', { requireMobile: true })).toBe('+447911123456');
      expect(normalizePhone('+14155552671', { requireMobile: true })).toBe('+14155552671');
    });
  });

  it('reads a number without a country code in the country given', () => {
    expect(normalizePhone('07911 123456', { country: 'GB' })).toBe('+447911123456');
  });
});
