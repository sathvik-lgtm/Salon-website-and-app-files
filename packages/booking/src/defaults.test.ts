import { describe, expect, it } from 'vitest';
import { bookingConfig } from './config';
import { createAppointment } from './create';
import { getAvailableSlots } from './slots';
import { createMemoryPort, type MemData } from './test-support/memory-port';
import { makeWorld } from './test-support/world';
import type { CreateInput } from './types';

/** The live defaults in config.ts, with no overrides: what the website will actually enforce. */

const DATE = '2026-11-09'; // Monday
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

function solo(): MemData {
  const w = makeWorld();
  w.staff = w.staff.filter((s) => s.id === 's1');
  return w;
}

const slots = async (w: MemData, date: string, now: Date, serviceIds = ['cut']) => {
  const r = await getAvailableSlots(
    createMemoryPort(w),
    { branchId: 'b1', serviceIds, date, stylistId: 'ANY' },
    { now },
  );
  return r.ok ? r.slots.map((s) => s.time) : r.reason;
};

const book = (
  port: ReturnType<typeof createMemoryPort>,
  at: string,
  phone: string,
  now: Date,
  over: Partial<CreateInput> = {},
) =>
  createAppointment(
    port,
    {
      branchId: 'b1',
      serviceIds: ['cut'],
      startAt: ist(DATE, at),
      stylistId: 'ANY',
      customer: { name: 'P', phone },
      source: 'ONLINE',
      ...over,
    },
    { now },
  );

describe('default booking rules', () => {
  it('are the values the owner chose', () => {
    expect(bookingConfig).toEqual({
      slotGranularityMin: 15,
      bufferMin: 0,
      minNoticeMin: 30,
      windowDays: 7,
      maxUpcomingPerPhone: 2,
    });
  });

  it('offers a start every 15 minutes (10:00, 10:15, 10:30, 10:45)', async () => {
    const t = await slots(solo(), DATE, ist('2026-11-08', '09:00'));
    expect(t).toEqual(expect.arrayContaining(['10:00', '10:15', '10:30', '10:45', '11:00']));
    expect(t.slice(0, 5)).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00']);
    expect(t.at(-1)).toBe('18:00'); // 60 min service, shift ends 19:00
  });

  it('accepts a 15 or 45 minute start online, but not 10:20', async () => {
    const now = ist('2026-11-08', '09:00');
    const port = createMemoryPort(solo());
    expect((await book(port, '10:15', '+919876543210', now, { stylistId: 's1' })).ok).toBe(true);
    expect((await book(port, '11:45', '+919812345678', now, { stylistId: 's1' })).ok).toBe(true);
    expect(await book(port, '13:20', '+919823456789', now, { stylistId: 's1' })).toEqual({
      ok: false,
      reason: 'SLOT_UNAVAILABLE',
    });
  });

  it('needs 30 minutes notice: exactly half an hour is fine, a minute less is not', async () => {
    const w = solo();
    expect((await slots(w, DATE, ist(DATE, '09:30')))[0]).toBe('10:00');
    expect((await slots(w, DATE, ist(DATE, '09:31')))[0]).toBe('10:15');

    const port = createMemoryPort(w);
    expect(await book(port, '10:00', '+919876543210', ist(DATE, '09:31'))).toEqual({
      ok: false,
      reason: 'TOO_SOON',
    });
    expect((await book(port, '10:00', '+919876543210', ist(DATE, '09:30'))).ok).toBe(true);
  });

  it('allows bookings today through 7 days ahead, and no further', async () => {
    const w = solo();
    const now = ist('2026-11-02', '09:00'); // Monday
    expect((await slots(w, '2026-11-02', now)).length).toBeGreaterThan(0); // today
    expect((await slots(w, '2026-11-09', now)).length).toBeGreaterThan(0); // +7 days
    expect(await slots(w, '2026-11-10', now)).toBe('OUTSIDE_BOOKING_WINDOW'); // +8 days
    expect(await slots(w, '2026-11-01', now)).toBe('OUTSIDE_BOOKING_WINDOW'); // yesterday

    const port = createMemoryPort(w);
    expect(
      await book(port, '10:00', '+919876543210', now, { startAt: ist('2026-11-10', '10:00') }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_BOOKING_WINDOW' });
  });

  it('allows 2 upcoming online bookings per phone; a third is refused', async () => {
    const now = ist('2026-11-08', '09:00');
    const port = createMemoryPort(makeWorld());
    expect((await book(port, '10:00', '+919876543210', now)).ok).toBe(true);
    expect((await book(port, '11:00', '98765 43210', now)).ok).toBe(true);
    expect(await book(port, '12:00', '+91 98765-43210', now)).toEqual({
      ok: false,
      reason: 'PHONE_LIMIT_REACHED',
    });
    // Staff phone bookings are not capped, and other numbers are unaffected.
    expect((await book(port, '12:00', '+919876543210', now, { source: 'PHONE' })).ok).toBe(true);
    expect((await book(port, '12:00', '+919812345678', now)).ok).toBe(true);
  });
});
