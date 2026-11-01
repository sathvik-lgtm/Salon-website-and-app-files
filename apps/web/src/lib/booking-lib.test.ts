import { describe, expect, it } from 'vitest';
import { errorMessage } from './booking-copy';
import {
  addDays,
  clockTime,
  dateAndTime,
  dayLabel,
  groupByHour,
  localDate,
  localParts,
  longDate,
  windowDates,
} from './dates';
import { buildIcs, foldLine } from './ics';
import { bookingReference, parseReceipt, receiptFromText, type BookingReceipt } from './receipt';

describe('dates (always in the branch timezone)', () => {
  it('"today" is the branch-local date, not the visitor or UTC date', () => {
    const at = new Date('2026-11-09T19:00:00Z'); // 00:30 on the 10th in Kolkata
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-11-10');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-11-09');
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-11-09', 7)).toBe('2026-11-16');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('the booking window is today through today + N, inclusive', () => {
    const dates = windowDates(new Date('2026-11-09T19:00:00Z'), 'Asia/Kolkata', 7);
    expect(dates).toHaveLength(8);
    expect(dates[0]).toBe('2026-11-10');
    expect(dates[7]).toBe('2026-11-17');
  });

  it('labels days for the date buttons', () => {
    expect(dayLabel('2026-11-09')).toEqual({ weekday: 'Mon', day: '9 Nov' });
    expect(longDate('2026-11-09')).toMatch(/Monday,? 9 November 2026/);
  });

  it('reads an instant as branch-local date and time', () => {
    expect(localParts('2026-11-09T04:30:00.000Z', 'Asia/Kolkata')).toEqual({
      date: '2026-11-09',
      time: '10:00',
    });
    // Auckland is UTC+13 in November: 21:00 UTC on the 9th is 10:00 on the 10th.
    expect(localParts('2026-11-09T21:00:00.000Z', 'Pacific/Auckland')).toEqual({
      date: '2026-11-10',
      time: '10:00',
    });
    expect(clockTime('2026-11-09T04:30:00.000Z', 'Asia/Kolkata')).toBe('10:00 am');
    expect(dateAndTime('2026-11-09T12:45:00.000Z', 'Asia/Kolkata')).toMatch(
      /Monday,? 9 November 2026 at 6:15 pm/,
    );
  });

  it('groups start times by hour with 12-hour labels', () => {
    expect(groupByHour(['10:00', '10:05', '11:00', '12:30', '13:00', '00:15'])).toEqual([
      { hour: 0, label: '12 am', times: ['00:15'] },
      { hour: 10, label: '10 am', times: ['10:00', '10:05'] },
      { hour: 11, label: '11 am', times: ['11:00'] },
      { hour: 12, label: '12 pm', times: ['12:30'] },
      { hour: 13, label: '1 pm', times: ['13:00'] },
    ]);
  });
});

describe('calendar file (.ics)', () => {
  const event = {
    uid: 'booking-abc@salon',
    start: new Date('2026-11-09T04:30:00Z'),
    end: new Date('2026-11-09T05:30:00Z'),
    summary: 'Hair, Spa; Colour at Branch One',
    location: '1 Test Street, Placeville',
    description: 'Haircut\nBring a photo',
    stamp: new Date('2026-11-01T10:00:00Z'),
  };

  it('is a valid single-event calendar with UTC times and CRLF endings', () => {
    const ics = buildIcs(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('\r\nUID:booking-abc@salon\r\n');
    expect(ics).toContain('\r\nDTSTAMP:20261101T100000Z\r\n');
    expect(ics).toContain('\r\nDTSTART:20261109T043000Z\r\n');
    expect(ics).toContain('\r\nDTEND:20261109T053000Z\r\n');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // no bare line breaks anywhere
  });

  it('escapes commas, semicolons and line breaks in text', () => {
    const ics = buildIcs(event);
    expect(ics).toContain('SUMMARY:Hair\\, Spa\\; Colour at Branch One');
    expect(ics).toContain('LOCATION:1 Test Street\\, Placeville');
    expect(ics).toContain('DESCRIPTION:Haircut\\nBring a photo');
  });

  it('leaves out location and description when not given', () => {
    const ics = buildIcs({ ...event, location: undefined, description: undefined });
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('DESCRIPTION');
  });

  it('folds long lines at 75 bytes and unfolds back to the original', () => {
    const long = 'DESCRIPTION:' + 'a'.repeat(200);
    const folded = foldLine(long);
    for (const physical of folded.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('never splits a multi-byte character when folding', () => {
    const rupees = 'DESCRIPTION:' + '₹'.repeat(60); // each ₹ is 3 bytes
    const folded = foldLine(rupees);
    for (const physical of folded.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(folded).not.toContain('�');
    expect(folded.replace(/\r\n /g, '')).toBe(rupees);
  });
});

describe('saved confirmation (receipt)', () => {
  const receipt: BookingReceipt = {
    id: 'clx1234567890abcdef',
    branchName: 'Branch One',
    branchAddress: '1 Test Street',
    branchPhone: '+919876543210',
    staffName: 'Asha',
    startAt: '2026-11-09T04:30:00.000Z',
    endAt: '2026-11-09T05:15:00.000Z',
    timezone: 'Asia/Kolkata',
    totalPricePaise: 60000,
    totalDurationMin: 45,
    items: [{ serviceName: 'Haircut & Style', pricePaise: 60000, durationMin: 45 }],
  };

  it('accepts a well-formed receipt', () => {
    expect(parseReceipt(receipt)).toEqual(receipt);
    expect(receiptFromText(JSON.stringify(receipt))).toEqual(receipt);
  });

  it('rejects anything missing, edited or malformed', () => {
    expect(parseReceipt(null)).toBeNull();
    expect(parseReceipt('text')).toBeNull();
    expect(parseReceipt({ ...receipt, id: 5 })).toBeNull();
    expect(parseReceipt({ ...receipt, startAt: 'not a date' })).toBeNull();
    expect(parseReceipt({ ...receipt, items: [] })).toBeNull();
    expect(parseReceipt({ ...receipt, items: [{ serviceName: 'x' }] })).toBeNull();
    expect(parseReceipt({ ...receipt, totalPricePaise: '600' })).toBeNull();
    const missing: Partial<BookingReceipt> = { ...receipt };
    delete missing.branchPhone;
    expect(parseReceipt(missing)).toBeNull();
  });

  it('treats absent or corrupt stored text as no receipt', () => {
    expect(receiptFromText(null)).toBeNull();
    expect(receiptFromText('')).toBeNull();
    expect(receiptFromText('{broken')).toBeNull();
  });

  it('gives a short reference to quote on the phone', () => {
    expect(bookingReference('clx1234567890abcdef')).toBe('90ABCDEF');
  });
});

describe('customer-facing error wording', () => {
  it('speaks plainly and never leaks technical detail', () => {
    expect(errorMessage('SLOT_TAKEN')).toMatch(/just been taken/);
    expect(errorMessage('SLOT_UNAVAILABLE')).toBe(errorMessage('SLOT_TAKEN'));
    expect(errorMessage('INVALID_PHONE')).toMatch(/mobile number/);
    expect(errorMessage('PHONE_LIMIT_REACHED')).toMatch(/2 upcoming bookings/);
    expect(errorMessage('OUTSIDE_BOOKING_WINDOW')).toMatch(/7 days ahead/);
  });

  it('points to the branch phone when something fails', () => {
    expect(errorMessage('SERVER_ERROR', '+91 98765 43210')).toContain('+91 98765 43210');
    expect(errorMessage('RATE_LIMITED', '+91 98765 43210')).toContain('+91 98765 43210');
    expect(errorMessage(undefined)).toMatch(/call the branch/);
    expect(errorMessage('SOMETHING_NEW')).toMatch(/Something went wrong/);
  });
});
