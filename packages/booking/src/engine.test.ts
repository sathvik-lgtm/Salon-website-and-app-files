import { describe, expect, it } from 'vitest';
import { createAppointment } from './create';
import { getAvailableSlots } from './slots';
import { createMemoryPort, type MemData } from './test-support/memory-port';
import { RULES } from './test-support/rules';
import { H, allWeekHours, makeWorld, weekly } from './test-support/world';
import type { CreateInput, EngineOptions, SlotsResult } from './types';

// Monday 2026-11-09 in Asia/Kolkata (UTC+05:30, no daylight saving).
const DATE = '2026-11-09';
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const NOW = ist('2026-11-08', '09:00');
const opts: EngineOptions = { now: NOW, config: RULES };

const PHONE = '+919876543210';

/** The world with a single stylist, s1. */
function solo(): MemData {
  const w = makeWorld();
  w.staff = w.staff.filter((s) => s.id === 's1');
  return w;
}

/** Block out [from, to) on DATE for a stylist with an appointment of the given status. */
function book(w: MemData, staffId: string, from: string, to: string, status = 'CONFIRMED') {
  w.appointments.push({
    id: `seed-${w.appointments.length}`,
    staffId,
    customerId: 'seed',
    startAt: ist(DATE, from),
    endAt: ist(DATE, to),
    status,
  });
}

const slotsFor = async (
  w: MemData,
  serviceIds: string[],
  stylistId = 'ANY',
  date = DATE,
  o: EngineOptions = opts,
): Promise<SlotsResult> =>
  getAvailableSlots(createMemoryPort(w), { branchId: 'b1', serviceIds, date, stylistId }, o);

async function times(w: MemData, serviceIds: string[], stylistId = 'ANY', date = DATE, o = opts) {
  const r = await slotsFor(w, serviceIds, stylistId, date, o);
  if (!r.ok) throw new Error(`expected slots, got ${r.reason}`);
  return r.slots.map((s) => s.time);
}

const baseInput = (over: Partial<CreateInput> = {}): CreateInput => ({
  branchId: 'b1',
  serviceIds: ['cut'],
  startAt: ist(DATE, '10:00'),
  stylistId: 's1',
  customer: { name: 'Test Customer', phone: PHONE },
  source: 'ONLINE',
  ...over,
});

describe('getAvailableSlots', () => {
  it('offers every half hour from opening to the last start that still fits the shift', async () => {
    const t = await times(solo(), ['cut']);
    expect(t[0]).toBe('10:00');
    expect(t.at(-1)).toBe('18:00');
    expect(t).toHaveLength(17);
  });

  it('returns the instant for each branch-local time', async () => {
    const r = await slotsFor(solo(), ['cut']);
    if (!r.ok) throw new Error(r.reason);
    expect(r.slots[0]?.startAt.toISOString()).toBe('2026-11-09T04:30:00.000Z'); // 10:00 IST
  });

  it('back-to-back: a booking ends exactly when the next may start', async () => {
    const w = solo();
    book(w, 's1', '10:00', '11:00');
    const t = await times(w, ['cut']);
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('10:30');
    expect(t[0]).toBe('11:00'); // end == start is allowed
  });

  it('last slot of the day depends on the service length', async () => {
    expect((await times(solo(), ['trim'])).at(-1)).toBe('18:30'); // 30 min, shift ends 19:00
    expect((await times(solo(), ['cut'])).at(-1)).toBe('18:00');
    expect((await times(solo(), ['colour'])).at(-1)).toBe('17:00'); // 120 min
  });

  it('refuses a start where the service is longer than the time that remains', async () => {
    const t = await times(solo(), ['colour']);
    expect(t).not.toContain('17:30'); // 17:30 + 2h runs past 19:00
  });

  it('is bounded by branch hours even when the stylist works later', async () => {
    const w = solo();
    w.staff[0]!.schedules = weekly(H(10), H(21)); // branch closes at 20:00
    expect((await times(w, ['cut'])).at(-1)).toBe('19:00');
  });

  it('removes slots overlapped by part of a time-off period', async () => {
    const w = solo();
    w.timeOff.push({ staffId: 's1', startAt: ist(DATE, '12:20'), endAt: ist(DATE, '12:50') });
    const t = await times(w, ['cut']);
    expect(t).toContain('11:00'); // 11:00-12:00 ends before the time off
    expect(t).not.toContain('11:30'); // 11:30-12:30 overlaps its start
    expect(t).not.toContain('12:00');
    expect(t).not.toContain('12:30'); // starts inside the time off
    expect(t).toContain('13:00');
  });

  it('applies the per-branch duration override', async () => {
    const w = solo();
    w.branches.push({ id: 'b2', timezone: 'Asia/Kolkata', hours: allWeekHours });
    w.staff.push({ ...w.staff[0]!, id: 's9', homeBranchId: 'b2' });
    w.branchServices.push({ branchId: 'b2', serviceId: 'colour', durationMin: 90 });

    const base = await times(w, ['colour']); // b1: 120 min
    expect(base.at(-1)).toBe('17:00');
    const r = await getAvailableSlots(
      createMemoryPort(w),
      { branchId: 'b2', serviceIds: ['colour'], date: DATE, stylistId: 'ANY' },
      opts,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.slots.at(-1)?.time).toBe('17:30'); // 90 min fits one half hour later
  });

  it('rejects a service that is not offered at the branch', async () => {
    const hidden = solo();
    hidden.branchServices.find((b) => b.serviceId === 'cut')!.available = false;
    expect(await slotsFor(hidden, ['cut'])).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });

    const noRow = solo();
    noRow.branchServices = noRow.branchServices.filter((b) => b.serviceId !== 'cut');
    expect(await slotsFor(noRow, ['cut'])).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });

    const inactive = solo();
    inactive.services.find((s) => s.id === 'cut')!.active = false;
    expect(await slotsFor(inactive, ['cut'])).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('rejects an unqualified stylist, and ANY skips unqualified stylists', async () => {
    const w = makeWorld();
    w.staff.find((s) => s.id === 's1')!.serviceIds = ['cut']; // not qualified for colour
    expect(await slotsFor(w, ['colour'], 's1')).toEqual({
      ok: false,
      reason: 'STYLIST_NOT_ELIGIBLE',
    });

    // Only s1 can't do colour; s1 is busy all day so ANY must come from s2/s3 alone.
    book(w, 's2', '10:00', '19:00');
    book(w, 's3', '10:00', '12:00');
    const t = await times(w, ['colour']);
    expect(t[0]).toBe('12:00'); // s3 frees up at noon; s1 never counted
  });

  it('multi-service needs one stylist qualified for all services', async () => {
    const w = makeWorld();
    w.staff.find((s) => s.id === 's1')!.serviceIds = ['cut'];
    w.staff.find((s) => s.id === 's2')!.serviceIds = ['colour'];
    // s3 is the only one who can do both.
    book(w, 's3', '10:00', '14:00');
    const t = await times(w, ['cut', 'colour']); // 3 hours
    expect(t[0]).toBe('14:00');
  });

  it('excludes inactive and non-bookable stylists', async () => {
    const w = solo();
    w.staff[0]!.bookable = false;
    expect(await slotsFor(w, ['cut'], 's1')).toEqual({ ok: false, reason: 'STYLIST_NOT_ELIGIBLE' });
    w.staff[0]!.bookable = true;
    w.staff[0]!.active = false;
    expect(await slotsFor(w, ['cut'], 's1')).toEqual({ ok: false, reason: 'STYLIST_NOT_ELIGIBLE' });
  });

  it('has no slots on a day the branch is closed or the stylist is off', async () => {
    const closed = solo();
    closed.branches[0]!.hours = { ...allWeekHours, mon: null };
    expect(await times(closed, ['cut'])).toEqual([]);

    const dayOff = solo();
    dayOff.staff[0]!.schedules = dayOff.staff[0]!.schedules.filter((r) => r.weekday !== 1);
    expect(await times(dayOff, ['cut'])).toEqual([]);
  });

  it('treats a break between two shifts as unavailable, but merges touching shifts', async () => {
    const split = solo();
    split.staff[0]!.schedules = [
      { weekday: 1, startMinute: H(10), endMinute: H(13) },
      { weekday: 1, startMinute: H(14), endMinute: H(19) },
    ];
    const t = await times(split, ['cut']);
    expect(t).toContain('12:00');
    expect(t).not.toContain('12:30'); // would run into the break
    expect(t).toContain('14:00');

    const touching = solo();
    touching.staff[0]!.schedules = [
      { weekday: 1, startMinute: H(10), endMinute: H(13) },
      { weekday: 1, startMinute: H(13), endMinute: H(19) },
    ];
    expect(await times(touching, ['cut'])).toContain('12:30');
  });

  it('keeps the configured buffer between appointments', async () => {
    const w = solo();
    book(w, 's1', '10:00', '11:00');
    const t = await times(w, ['cut'], 'ANY', DATE, {
      now: NOW,
      config: { ...RULES, bufferMin: 30 },
    });
    expect(t).not.toContain('11:00'); // no gap
    expect(t[0]).toBe('11:30');
  });

  it('cancelled and no-show bookings do not block a slot', async () => {
    const w = solo();
    book(w, 's1', '10:00', '11:00', 'CANCELLED');
    book(w, 's1', '11:00', '12:00', 'NO_SHOW');
    expect((await times(w, ['cut']))[0]).toBe('10:00');
  });

  it('checked-in and completed bookings still occupy time', async () => {
    const w = solo();
    book(w, 's1', '10:00', '11:00', 'CHECKED_IN');
    book(w, 's1', '11:00', '12:00', 'COMPLETED');
    expect((await times(w, ['cut']))[0]).toBe('12:00');
  });

  it('ANY offers a time when at least one stylist is free', async () => {
    const w = makeWorld();
    book(w, 's1', '10:00', '11:00');
    book(w, 's2', '10:00', '11:00');
    expect((await times(w, ['cut']))[0]).toBe('10:00'); // s3 is free
    book(w, 's3', '10:00', '11:00');
    expect((await times(w, ['cut']))[0]).toBe('11:00');
  });

  describe('minimum notice and booking window', () => {
    it('minimum notice: the first slot is exactly now + 120 min, not earlier', async () => {
      const w = solo();
      const at = (hhmm: string) => ({ config: RULES, now: ist(DATE, hhmm) });
      expect((await times(w, ['cut'], 'ANY', DATE, at('08:00')))[0]).toBe('10:00'); // exactly 120 min
      expect((await times(w, ['cut'], 'ANY', DATE, at('08:01')))[0]).toBe('10:30'); // 119 min to 10:00
    });

    it('window: today and the 60th day ahead are bookable, the 61st is not', async () => {
      const w = solo();
      const o = { config: RULES, now: ist('2026-11-02', '09:00') };
      expect((await times(w, ['cut'], 'ANY', '2026-11-02', o)).length).toBeGreaterThan(0);
      expect((await times(w, ['cut'], 'ANY', '2027-01-01', o)).length).toBeGreaterThan(0); // +60 days
      expect(await slotsFor(w, ['cut'], 'ANY', '2027-01-02', o)).toEqual({
        ok: false,
        reason: 'OUTSIDE_BOOKING_WINDOW',
      });
      expect(await slotsFor(w, ['cut'], 'ANY', '2026-11-01', o)).toEqual({
        ok: false,
        reason: 'OUTSIDE_BOOKING_WINDOW',
      });
    });
  });

  describe('timezone boundaries', () => {
    it('"today" is the branch-local date, not the UTC date', async () => {
      const w = solo();
      // 19:00 UTC on 9 Nov is 00:30 on 10 Nov in Kolkata.
      const o = { config: RULES, now: new Date('2026-11-09T19:00:00Z') };
      expect(await slotsFor(w, ['cut'], 'ANY', '2026-11-09', o)).toEqual({
        ok: false,
        reason: 'OUTSIDE_BOOKING_WINDOW',
      });
      expect((await times(w, ['cut'], 'ANY', '2026-11-10', o)).length).toBeGreaterThan(0);
    });

    it('a local date can start on the previous UTC date (Auckland, UTC+13)', async () => {
      const w = solo();
      w.branches[0]!.timezone = 'Pacific/Auckland';
      const o = { config: RULES, now: new Date('2026-11-01T00:00:00Z') };
      const r = await slotsFor(w, ['cut'], 'ANY', '2026-11-10', o);
      if (!r.ok) throw new Error(r.reason);
      expect(r.slots[0]?.time).toBe('10:00');
      expect(r.slots[0]?.startAt.toISOString()).toBe('2026-11-09T21:00:00.000Z');

      // An appointment at that UTC instant blocks 10:00 on the 10th (local), and nothing on the 9th.
      w.appointments.push({
        id: 'x',
        staffId: 's1',
        customerId: 'c',
        startAt: new Date('2026-11-09T21:00:00Z'),
        endAt: new Date('2026-11-09T22:00:00Z'),
        status: 'CONFIRMED',
      });
      expect((await times(w, ['cut'], 'ANY', '2026-11-10', o))[0]).toBe('11:00');
      expect((await times(w, ['cut'], 'ANY', '2026-11-09', o))[0]).toBe('10:00');
    });

    it('uses the right UTC offset on the day clocks change (New York, 1 Nov 2026)', async () => {
      const w = solo();
      w.branches[0]!.timezone = 'America/New_York';
      const o = { config: RULES, now: new Date('2026-10-20T00:00:00Z') };
      const before = await slotsFor(w, ['cut'], 'ANY', '2026-10-31', o); // EDT, UTC-4
      const after = await slotsFor(w, ['cut'], 'ANY', '2026-11-01', o); // EST, UTC-5
      if (!before.ok || !after.ok) throw new Error('expected slots');
      expect(before.slots[0]?.startAt.toISOString()).toBe('2026-10-31T14:00:00.000Z');
      expect(after.slots[0]?.startAt.toISOString()).toBe('2026-11-01T15:00:00.000Z');
    });
  });

  it('rejects malformed input', async () => {
    const w = solo();
    expect(await slotsFor(w, ['cut'], 'ANY', '09-11-2026')).toEqual({
      ok: false,
      reason: 'INVALID_INPUT',
    });
    expect(await slotsFor(w, ['cut'], 'ANY', '2026-02-30')).toEqual({
      ok: false,
      reason: 'INVALID_INPUT',
    });
    expect(await slotsFor(w, [])).toEqual({ ok: false, reason: 'INVALID_INPUT' });
    expect(await slotsFor(w, ['cut', 'cut'])).toEqual({ ok: false, reason: 'INVALID_INPUT' });
    const unknown = await getAvailableSlots(
      createMemoryPort(w),
      { branchId: 'nope', serviceIds: ['cut'], date: DATE, stylistId: 'ANY' },
      opts,
    );
    expect(unknown).toEqual({ ok: false, reason: 'BRANCH_NOT_FOUND' });
  });
});

describe('createAppointment', () => {
  it('recomputes price, duration and end on the server and snapshots the items', async () => {
    const w = solo();
    w.branchServices.find((b) => b.serviceId === 'cut')!.pricePaise = 70_000; // branch override
    const port = createMemoryPort(w);
    // A client trying to smuggle in its own numbers: the engine has no way to read them.
    const sneaky = { ...baseInput(), totalPricePaise: 1, endAt: ist(DATE, '10:05') } as CreateInput;
    const r = await createAppointment(port, sneaky, opts);
    if (!r.ok) throw new Error(r.reason);

    expect(r.appointment.totalPricePaise).toBe(70_000);
    expect(r.appointment.totalDurationMin).toBe(60);
    expect(r.appointment.endAt).toEqual(ist(DATE, '11:00'));
    expect(r.appointment.items).toEqual([
      { serviceId: 'cut', serviceName: 'Haircut', pricePaise: 70_000, durationMin: 60 },
    ]);

    const row = w.appointments[0]!;
    expect(row.status).toBe('CONFIRMED');
    expect(row.source).toBe('ONLINE');
    expect(row.stylistPreference).toBe('SPECIFIC');
    expect(row.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('books several services as one continuous block with one stylist', async () => {
    const w = solo();
    const r = await createAppointment(
      createMemoryPort(w),
      baseInput({ serviceIds: ['cut', 'trim'] }),
      opts,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.appointment.totalDurationMin).toBe(90);
    expect(r.appointment.totalPricePaise).toBe(90_000);
    expect(r.appointment.endAt).toEqual(ist(DATE, '11:30'));
    expect(r.appointment.items.map((i) => i.serviceId)).toEqual(['cut', 'trim']);
    expect(w.appointments).toHaveLength(1);
  });

  it('accepts back-to-back bookings (end == start)', async () => {
    const w = solo();
    const port = createMemoryPort(w);
    expect((await createAppointment(port, baseInput(), opts)).ok).toBe(true);
    const next = await createAppointment(
      port,
      baseInput({ startAt: ist(DATE, '11:00'), customer: { name: 'B', phone: '+919812345678' } }),
      opts,
    );
    expect(next.ok).toBe(true);
  });

  it('refuses a slot that is already taken', async () => {
    const w = solo();
    book(w, 's1', '10:00', '11:00');
    expect(await createAppointment(createMemoryPort(w), baseInput(), opts)).toEqual({
      ok: false,
      reason: 'SLOT_TAKEN',
    });
  });

  it('refuses slots outside hours, shifts or time off as unavailable', async () => {
    const w = solo();
    w.timeOff.push({ staffId: 's1', startAt: ist(DATE, '14:00'), endAt: ist(DATE, '15:00') });
    const port = createMemoryPort(w);
    for (const at of ['09:30', '18:30', '14:00']) {
      expect(await createAppointment(port, baseInput({ startAt: ist(DATE, at) }), opts)).toEqual({
        ok: false,
        reason: 'SLOT_UNAVAILABLE',
      });
    }
  });

  it('online bookings must sit on the slot grid and respect notice and window', async () => {
    const port = createMemoryPort(solo());
    expect(await createAppointment(port, baseInput({ startAt: ist(DATE, '10:15') }), opts)).toEqual(
      {
        ok: false,
        reason: 'SLOT_UNAVAILABLE',
      },
    );
    expect(
      await createAppointment(port, baseInput(), { config: RULES, now: ist(DATE, '08:01') }),
    ).toEqual({
      ok: false,
      reason: 'TOO_SOON',
    });
    expect(
      await createAppointment(port, baseInput({ startAt: ist('2027-01-02', '10:00') }), {
        config: RULES,
        now: ist('2026-11-02', '09:00'),
      }),
    ).toEqual({ ok: false, reason: 'OUTSIDE_BOOKING_WINDOW' });
  });

  it('staff bookings may start off-grid and with no notice, but still need a free stylist', async () => {
    const w = solo();
    const port = createMemoryPort(w);
    const walkIn = await createAppointment(
      port,
      baseInput({ source: 'WALK_IN', startAt: ist(DATE, '10:15') }),
      { config: RULES, now: ist(DATE, '10:15') }, // right now: no notice
    );
    expect(walkIn.ok).toBe(true);
    const clash = await createAppointment(
      port,
      baseInput({
        source: 'PHONE',
        startAt: ist(DATE, '10:30'),
        customer: { name: 'B', phone: '+919812345678' },
      }),
      { config: RULES, now: ist(DATE, '10:15') },
    );
    expect(clash).toEqual({ ok: false, reason: 'SLOT_TAKEN' });
  });

  describe('ANY stylist', () => {
    it('picks the stylist with the fewest bookings that day and records the preference', async () => {
      const w = makeWorld();
      book(w, 's1', '12:00', '13:00');
      book(w, 's1', '14:00', '15:00');
      book(w, 's2', '12:00', '13:00');
      // s3 has none.
      const r = await createAppointment(createMemoryPort(w), baseInput({ stylistId: 'ANY' }), opts);
      if (!r.ok) throw new Error(r.reason);
      expect(r.appointment.staffId).toBe('s3');
      expect(r.appointment.stylistPreference).toBe('ANY_AVAILABLE');
      expect(w.appointments.at(-1)?.stylistPreference).toBe('ANY_AVAILABLE');
    });

    it('breaks ties deterministically by stylist id', async () => {
      for (let i = 0; i < 3; i++) {
        const w = makeWorld();
        w.staff.reverse(); // input order must not matter
        const r = await createAppointment(
          createMemoryPort(w),
          baseInput({ stylistId: 'ANY' }),
          opts,
        );
        if (!r.ok) throw new Error(r.reason);
        expect(r.appointment.staffId).toBe('s1');
      }
    });

    it('balances load: successive bookings spread across stylists', async () => {
      const w = makeWorld();
      const port = createMemoryPort(w);
      const used: string[] = [];
      for (const [i, at] of ['10:00', '10:00', '10:00', '11:00'].entries()) {
        const r = await createAppointment(
          port,
          baseInput({
            stylistId: 'ANY',
            startAt: ist(DATE, at),
            customer: { name: `C${i}`, phone: `+9198123456${70 + i}` },
          }),
          opts,
        );
        if (!r.ok) throw new Error(r.reason);
        used.push(r.appointment.staffId);
      }
      expect(used.slice(0, 3).sort()).toEqual(['s1', 's2', 's3']);
      expect(used[3]).toBe('s1'); // all have 1 booking again; tie -> lowest id
    });

    it('retries the next-best stylist when the first loses the race', async () => {
      const w = makeWorld();
      const port = createMemoryPort(w, { failInsertFor: ['s1'] }); // s1 ranks first, then is taken
      const r = await createAppointment(port, baseInput({ stylistId: 'ANY' }), opts);
      if (!r.ok) throw new Error(r.reason);
      expect(r.appointment.staffId).toBe('s2');
    });

    it('gives up with SLOT_TAKEN when every candidate loses the race', async () => {
      const port = createMemoryPort(makeWorld(), { failInsertFor: ['s1', 's2', 's3'] });
      expect(await createAppointment(port, baseInput({ stylistId: 'ANY' }), opts)).toEqual({
        ok: false,
        reason: 'SLOT_TAKEN',
      });
    });

    it('a specific stylist is not swapped when they lose the race', async () => {
      const port = createMemoryPort(makeWorld(), { failInsertFor: ['s1'] });
      expect(await createAppointment(port, baseInput({ stylistId: 's1' }), opts)).toEqual({
        ok: false,
        reason: 'SLOT_TAKEN',
      });
    });
  });

  describe('per-phone limit', () => {
    const attempt = (
      port: ReturnType<typeof createMemoryPort>,
      at: string,
      phone: string,
      source: CreateInput['source'] = 'ONLINE',
    ) =>
      createAppointment(
        port,
        baseInput({
          stylistId: 'ANY',
          startAt: ist(DATE, at),
          customer: { name: 'P', phone },
          source,
        }),
        opts,
      );

    it('allows 3 upcoming online bookings per phone, however the number is written', async () => {
      const port = createMemoryPort(makeWorld());
      expect((await attempt(port, '10:00', '+919876543210')).ok).toBe(true);
      expect((await attempt(port, '11:00', '98765 43210')).ok).toBe(true);
      expect((await attempt(port, '12:00', '09876543210')).ok).toBe(true);
      expect(await attempt(port, '13:00', '+91 98765-43210')).toEqual({
        ok: false,
        reason: 'PHONE_LIMIT_REACHED',
      });
      // A different number is unaffected.
      expect((await attempt(port, '13:00', '+919812345678')).ok).toBe(true);
    });

    it('ignores cancelled and past bookings, and does not limit staff bookings', async () => {
      const w = makeWorld();
      const port = createMemoryPort(w);
      for (const at of ['10:00', '11:00', '12:00']) await attempt(port, at, PHONE);
      w.appointments[0]!.status = 'CANCELLED';
      expect((await attempt(port, '13:00', PHONE)).ok).toBe(true); // freed one

      expect(await attempt(port, '14:00', PHONE)).toEqual({
        ok: false,
        reason: 'PHONE_LIMIT_REACHED',
      });
      expect((await attempt(port, '14:00', PHONE, 'PHONE')).ok).toBe(true); // staff bypass

      // Bookings that have already started do not count as upcoming.
      const later = await createAppointment(
        port,
        baseInput({
          stylistId: 'ANY',
          startAt: ist(DATE, '15:00'),
          customer: { name: 'P', phone: PHONE },
        }),
        {
          config: RULES,
          now: ist(DATE, '12:30'),
        },
      );
      expect(later.ok).toBe(true);
    });
  });

  it('rejects bad phones and malformed input', async () => {
    const port = createMemoryPort(solo());
    expect(
      await createAppointment(port, baseInput({ customer: { name: 'A', phone: '12345' } }), opts),
    ).toEqual({ ok: false, reason: 'INVALID_PHONE' });
    for (const bad of [
      baseInput({ serviceIds: [] }),
      baseInput({ serviceIds: ['cut', 'cut'] }),
      baseInput({ customer: { name: '   ', phone: PHONE } }),
      baseInput({ startAt: new Date('nope') }),
      baseInput({ source: 'FAX' as never }),
    ]) {
      expect(await createAppointment(port, bad, opts)).toEqual({
        ok: false,
        reason: 'INVALID_INPUT',
      });
    }
    expect(await createAppointment(port, baseInput({ branchId: 'nope' }), opts)).toEqual({
      ok: false,
      reason: 'BRANCH_NOT_FOUND',
    });
    expect(await createAppointment(port, baseInput({ serviceIds: ['missing'] }), opts)).toEqual({
      ok: false,
      reason: 'SERVICE_UNAVAILABLE',
    });
    expect(await createAppointment(port, baseInput({ stylistId: 'ghost' }), opts)).toEqual({
      ok: false,
      reason: 'STYLIST_NOT_ELIGIBLE',
    });
  });
});
