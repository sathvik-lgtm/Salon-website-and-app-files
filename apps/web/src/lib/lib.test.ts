import { describe, expect, it } from 'vitest';
import type { BranchHours } from '@salon/db/hours';
import { BRANCH_COOKIE, branchCookieString, readBranchCookie } from './branch-cookie';
import {
  formatDate,
  formatDuration,
  formatPeriod,
  formatPhone,
  formatPrice,
  fullAddress,
  telHref,
} from './format';
import { formatTime, hoursRows, openStatus } from './hours';
import { branchJsonLd, openingHoursSpecification } from './jsonld';
import type { BranchView } from './types';

const std = { open: '10:00', close: '20:00' };
const week: BranchHours = {
  mon: std,
  tue: std,
  wed: std,
  thu: std,
  fri: std,
  sat: std,
  sun: null,
};

describe('formatTime / hoursRows', () => {
  it('uses a 12-hour clock', () => {
    expect(formatTime('00:00')).toBe('12:00 am');
    expect(formatTime('09:05')).toBe('9:05 am');
    expect(formatTime('12:30')).toBe('12:30 pm');
    expect(formatTime('20:00')).toBe('8:00 pm');
  });

  it('lists seven days, Monday first, with closed days marked', () => {
    const rows = hoursRows(week);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ day: 'Monday', text: '10:00 am – 8:00 pm' });
    expect(rows[6]).toEqual({ day: 'Sunday', text: 'Closed' });
  });
});

describe('openStatus (branch-local, Asia/Kolkata = UTC+05:30)', () => {
  const at = (iso: string) => openStatus(week, 'Asia/Kolkata', new Date(iso));

  it('is open during hours and says when it closes', () => {
    expect(at('2026-11-09T05:00:00Z')).toEqual({ open: true, text: 'Open now · closes 8:00 pm' }); // Mon 10:30
  });

  it('opens exactly at opening time', () => {
    expect(at('2026-11-09T04:30:00Z').open).toBe(true); // Mon 10:00
    expect(at('2026-11-09T04:29:00Z')).toEqual({
      open: false,
      text: 'Closed · opens today at 10:00 am',
    });
  });

  it('is closed exactly at closing time', () => {
    expect(at('2026-11-09T14:30:00Z')).toEqual({
      open: false,
      text: 'Closed · opens tomorrow at 10:00 am',
    }); // Mon 20:00
    expect(at('2026-11-09T14:29:00Z').open).toBe(true); // Mon 19:59
  });

  it('skips a closed day to the next open one', () => {
    // Saturday 20:30 IST: Sunday is closed, so Monday.
    expect(at('2026-11-14T15:00:00Z')).toEqual({
      open: false,
      text: 'Closed · opens Monday at 10:00 am',
    });
    // Sunday noon IST: closed all day, opens tomorrow.
    expect(at('2026-11-15T06:30:00Z')).toEqual({
      open: false,
      text: 'Closed · opens tomorrow at 10:00 am',
    });
  });

  it('uses the branch timezone, not the visitor one', () => {
    // 22:00 UTC on Sunday 8 Nov is already 11:00 on Monday 9 Nov in Auckland (UTC+13).
    expect(openStatus(week, 'Pacific/Auckland', new Date('2026-11-08T22:00:00Z')).open).toBe(true);
    expect(openStatus(week, 'Asia/Kolkata', new Date('2026-11-08T22:00:00Z')).open).toBe(false);
  });

  it('copes with a branch that is closed every day', () => {
    const shut: BranchHours = {
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    };
    expect(openStatus(shut, 'Asia/Kolkata', new Date('2026-11-09T05:00:00Z'))).toEqual({
      open: false,
      text: 'Closed',
    });
  });
});

describe('format', () => {
  it('prices use Indian grouping and drop empty paise', () => {
    expect(formatPrice(60_000)).toBe('₹600');
    expect(formatPrice(350_000)).toBe('₹3,500');
    expect(formatPrice(10_000_000)).toBe('₹1,00,000');
    expect(formatPrice(55_050)).toBe('₹550.50');
  });

  it('durations read naturally', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(180)).toBe('3 hr');
  });

  it('phones group Indian numbers and link with tel:', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+14155550123')).toBe('+14155550123');
    expect(telHref('+919876543210')).toBe('tel:+919876543210');
  });

  it('adds the city to an address only when it is not already there', () => {
    expect(fullAddress('1 Test Street', 'Placeville')).toBe('1 Test Street, Placeville');
    expect(fullAddress('1 Test Street, Placeville 000001', 'Placeville')).toBe(
      '1 Test Street, Placeville 000001',
    );
    expect(fullAddress('1 Test Street, PLACEVILLE', 'Placeville')).toBe(
      '1 Test Street, PLACEVILLE',
    );
  });

  it('dates are shown in the salon timezone', () => {
    // 20:00 UTC on 1 Jan is 01:30 on 2 Jan in Kolkata.
    expect(formatDate('2027-01-01T20:00:00Z')).toBe('2 Jan 2027');
    expect(formatPeriod('QUARTERLY')).toBe('quarter');
  });
});

describe('branch cookie', () => {
  it('round-trips a slug', () => {
    expect(branchCookieString('branch-one')).toContain(`${BRANCH_COOKIE}=branch-one`);
    expect(branchCookieString('branch-one')).toMatch(/Path=\/.*SameSite=Lax/);
    expect(readBranchCookie(`a=1; ${BRANCH_COOKIE}=branch-two; b=2`)).toBe('branch-two');
  });

  it('returns null when missing or malformed', () => {
    expect(readBranchCookie('a=1; b=2')).toBeNull();
    expect(readBranchCookie('')).toBeNull();
    expect(readBranchCookie(`${BRANCH_COOKIE}=%E0%A4%A`)).toBeNull();
  });
});

describe('LocalBusiness JSON-LD', () => {
  const branch: BranchView = {
    id: 'b1',
    slug: 'branch-one',
    name: 'Branch One',
    city: 'Placeville',
    address: '1 Test Street',
    phone: '+919876543210',
    timezone: 'Asia/Kolkata',
    hours: { ...week, sun: { open: '11:00', close: '18:00' } },
    mapUrl: null,
    latitude: 12.5,
    longitude: 77.25,
    imageUrl: null,
  };

  it('groups days that share hours and leaves closed days out', () => {
    expect(openingHoursSpecification(week)).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '10:00',
        closes: '20:00',
      },
    ]);
    expect(openingHoursSpecification(branch.hours)).toHaveLength(2);
  });

  it('describes the branch with address, phone, geo and an absolute URL', () => {
    const ld = branchJsonLd(branch);
    expect(ld['@type']).toBe('BeautySalon');
    expect(ld.url).toBe('https://example.com/branches/branch-one');
    expect(ld.telephone).toBe('+919876543210');
    expect(ld.address).toMatchObject({ streetAddress: '1 Test Street', addressCountry: 'IN' });
    expect(ld.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 12.5, longitude: 77.25 });
  });

  it('omits geo and image when unknown', () => {
    const ld = branchJsonLd({ ...branch, latitude: null, longitude: null });
    expect(ld).not.toHaveProperty('geo');
    expect(ld).not.toHaveProperty('image');
  });
});
