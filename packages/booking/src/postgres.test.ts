/**
 * Runs the engine against a real Postgres through the Prisma port. This is where the exclusion
 * constraint is the actual arbiter: the concurrency tests prove two simultaneous creates for one
 * slot produce exactly one success. Each run creates its own uniquely named branch/staff/services
 * and deletes them afterwards, so it is safe on the local dev database.
 */
import { createDb, type Db } from '@salon/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppointment } from './create';
import { createPrismaPort, isLostRaceError } from './prisma-port';
import { getAvailableSlots } from './slots';
import { testDatabaseUrl } from './test-support/db-env';
import { H, allWeekHours } from './test-support/world';
import type { BookingPort, CreateInput } from './types';

const url = testDatabaseUrl();

/**
 * Makes a race deterministic. `getBusy` is the engine's last read before it writes, so holding it
 * until `parties` creates have all read guarantees every one of them saw the slot as free; the
 * Postgres constraint is then the only thing left that can stop a double booking.
 */
function withBarrier(inner: BookingPort, parties: number): BookingPort {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return {
    ...inner,
    async getBusy(...args) {
      const rows = await inner.getBusy(...args);
      if (++arrived >= parties) release();
      await gate;
      return rows;
    },
  };
}

const DATE = '2026-11-09'; // a Monday
const ist = (hhmm: string, date = DATE) => new Date(`${date}T${hhmm}:00+05:30`);
const opts = { now: new Date('2026-11-08T03:30:00Z') };

describe.skipIf(!url)('booking engine on real Postgres', () => {
  let db: Db;
  let port: BookingPort;
  const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const phones: string[] = [];
  const ids = {
    branch: '',
    other: '',
    category: '',
    cut: '',
    colour: '',
    hidden: '',
    s1: '',
    s2: '',
    s3: '',
  };
  let phoneCounter = 0;
  const nextPhone = () => {
    const phone = `+9170${String(Date.now() % 1e6).padStart(6, '0')}${String(phoneCounter++).padStart(2, '0')}`;
    phones.push(phone);
    return phone;
  };

  beforeAll(async () => {
    db = createDb(url!, 'pg');
    port = createPrismaPort(db);

    const branch = await db.branch.create({
      data: {
        slug: `${tag}-main`,
        name: `${tag} main`,
        address: 'test',
        city: 'test',
        phone: '+910000000000',
        hours: allWeekHours,
      },
    });
    const other = await db.branch.create({
      data: {
        slug: `${tag}-other`,
        name: `${tag} other`,
        address: 'test',
        city: 'test',
        phone: '+910000000000',
        hours: allWeekHours,
      },
    });
    const category = await db.serviceCategory.create({ data: { slug: `${tag}-cat`, name: tag } });
    const mk = (slug: string, price: number, min: number, active = true) =>
      db.service.create({
        data: {
          slug: `${tag}-${slug}`,
          name: slug,
          categoryId: category.id,
          basePricePaise: price,
          baseDurationMin: min,
          active,
        },
      });
    const [cut, colour, hidden] = await Promise.all([
      mk('cut', 60_000, 60),
      mk('colour', 350_000, 120),
      mk('hidden', 10_000, 30),
    ]);
    await db.branchService.createMany({
      data: [
        { branchId: branch.id, serviceId: cut.id },
        { branchId: branch.id, serviceId: colour.id, pricePaise: 400_000, durationMin: 90 },
        { branchId: branch.id, serviceId: hidden.id, available: false },
        { branchId: other.id, serviceId: cut.id },
      ],
    });

    const mkStaff = async (n: number, serviceIds: string[]) => {
      const staff = await db.staff.create({
        data: {
          name: `${tag} s${n}`,
          email: `${tag}-s${n}@example.invalid`,
          passwordHash: 'x',
          role: 'STYLIST',
          homeBranchId: branch.id,
          bookable: true,
        },
      });
      await db.staffService.createMany({
        data: serviceIds.map((serviceId) => ({ staffId: staff.id, serviceId })),
      });
      await db.staffSchedule.createMany({
        data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          staffId: staff.id,
          weekday,
          startMinute: H(10),
          endMinute: H(19),
        })),
      });
      return staff.id;
    };
    ids.s1 = await mkStaff(1, [cut.id, colour.id]);
    ids.s2 = await mkStaff(2, [cut.id, colour.id]);
    ids.s3 = await mkStaff(3, [cut.id]); // not qualified for colour
    Object.assign(ids, {
      branch: branch.id,
      other: other.id,
      category: category.id,
      cut: cut.id,
      colour: colour.id,
      hidden: hidden.id,
    });
  });

  afterAll(async () => {
    if (!db) return;
    const staffIds = [ids.s1, ids.s2, ids.s3];
    const serviceIds = [ids.cut, ids.colour, ids.hidden];
    await db.appointment.deleteMany({ where: { staffId: { in: staffIds } } }); // items cascade
    await db.customer.deleteMany({ where: { phone: { in: phones } } });
    await db.timeOff.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staffSchedule.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staffService.deleteMany({ where: { staffId: { in: staffIds } } });
    await db.staff.deleteMany({ where: { id: { in: staffIds } } });
    await db.branchService.deleteMany({ where: { serviceId: { in: serviceIds } } });
    await db.service.deleteMany({ where: { id: { in: serviceIds } } });
    await db.serviceCategory.deleteMany({ where: { id: ids.category } });
    await db.branch.deleteMany({ where: { id: { in: [ids.branch, ids.other] } } });
    await db.$disconnect();
  });

  const input = (over: Partial<CreateInput> = {}): CreateInput => ({
    branchId: ids.branch,
    serviceIds: [ids.cut],
    startAt: ist('10:00'),
    stylistId: ids.s1,
    customer: { name: 'Test Customer', phone: nextPhone() },
    source: 'ONLINE',
    ...over,
  });
  const slotTimes = async (serviceIds: string[], stylistId: string, date = DATE) => {
    const r = await getAvailableSlots(
      port,
      { branchId: ids.branch, serviceIds, date, stylistId },
      opts,
    );
    if (!r.ok) throw new Error(r.reason);
    return r.slots.map((s) => s.time);
  };

  it('maps the exclusion violation (SQLSTATE 23P01) to a typed slot-taken result', async () => {
    const day = '2026-11-16';
    const at = ist('11:00', day);
    const first = await createAppointment(port, input({ startAt: at }), opts);
    expect(first.ok).toBe(true);

    // Bypass the engine's own check and hit the constraint directly through the port.
    const raw = port.transaction(async (tx) => {
      const customerId = await tx.upsertCustomer({ name: 'x', phone: nextPhone() });
      return tx.insertAppointment({
        branchId: ids.branch,
        staffId: ids.s1,
        customerId,
        startAt: at,
        endAt: ist('12:00', day),
        status: 'CONFIRMED',
        source: 'ONLINE',
        stylistPreference: 'SPECIFIC',
        totalPricePaise: 1,
        totalDurationMin: 60,
        manageTokenHash: 'h',
        items: [],
      });
    });
    await expect(raw).rejects.toMatchObject({ name: 'SlotTakenError' });
  });

  it('isLostRaceError recognises lost races (also when nested) and ignores other errors', () => {
    // Prisma's wrapper for a deadlock victim, and the raw driver shapes.
    expect(isLostRaceError({ code: 'P2034', message: 'write conflict or a deadlock' })).toBe(true);
    expect(
      isLostRaceError({ meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } }),
    ).toBe(true);
    expect(isLostRaceError(new Error('deadlock detected'))).toBe(true);
    expect(isLostRaceError({ cause: { code: '23P01' } })).toBe(true);
    expect(isLostRaceError(new Error('conflicts with Appointment_no_staff_overlap'))).toBe(true);
    expect(isLostRaceError(new Error('connection refused'))).toBe(false);
    expect(isLostRaceError({ code: 'P2002', meta: { target: ['phone'] } })).toBe(false);
    expect(isLostRaceError(null)).toBe(false);
  });

  it('CONCURRENCY: two simultaneous creates for the same slot give exactly one success', async () => {
    const day = '2026-11-17';
    // Both creates pass the availability check before either inserts: only the constraint can decide.
    const racing = withBarrier(port, 2);
    const results = await Promise.all([
      createAppointment(racing, input({ startAt: ist('10:00', day) }), opts),
      createAppointment(racing, input({ startAt: ist('10:00', day) }), opts),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'SLOT_TAKEN' }]);
    expect(
      await db.appointment.count({ where: { staffId: ids.s1, startAt: ist('10:00', day) } }),
    ).toBe(1);
  });

  it('CONCURRENCY: ten simultaneous creates for one stylist and slot give exactly one success', async () => {
    const day = '2026-11-18';
    const racing = withBarrier(port, 10);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createAppointment(racing, input({ startAt: ist('10:00', day) }), opts),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'SLOT_TAKEN')).toHaveLength(9);
    expect(
      await db.appointment.count({ where: { staffId: ids.s1, startAt: ist('10:00', day) } }),
    ).toBe(1);
  });

  it('CONCURRENCY: ANY retries the next stylist, and the slot sells out at the number of stylists', async () => {
    const day = '2026-11-19';
    // Colour: only s1 and s2 are qualified. Four people race for 10:00.
    const racing = withBarrier(port, 4);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createAppointment(
          racing,
          input({ serviceIds: [ids.colour], stylistId: 'ANY', startAt: ist('10:00', day) }),
          opts,
        ),
      ),
    );
    const won = results.filter((r) => r.ok);
    expect(won).toHaveLength(2);
    expect(new Set(won.map((r) => r.ok && r.appointment.staffId))).toEqual(
      new Set([ids.s1, ids.s2]),
    );
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'SLOT_TAKEN' },
      { ok: false, reason: 'SLOT_TAKEN' },
    ]);
  });

  it('stores the server-computed snapshot, with branch overrides and one block for several services', async () => {
    const day = '2026-11-20';
    const r = await createAppointment(
      port,
      input({ serviceIds: [ids.cut, ids.colour], startAt: ist('12:00', day), stylistId: 'ANY' }),
      opts,
    );
    if (!r.ok) throw new Error(r.reason);

    const row = await db.appointment.findUniqueOrThrow({
      where: { id: r.appointment.id },
      include: { items: true },
    });
    // cut 60 min / 600 + colour override 90 min / 4000 => 150 min, 4600 rupees.
    expect(row.totalDurationMin).toBe(150);
    expect(row.totalPricePaise).toBe(460_000);
    expect(row.startAt).toEqual(ist('12:00', day));
    expect(row.endAt).toEqual(ist('14:30', day));
    expect(row.status).toBe('CONFIRMED');
    expect(row.source).toBe('ONLINE');
    expect(row.stylistPreference).toBe('ANY_AVAILABLE');
    expect(row.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.staffId).toBe(r.appointment.staffId); // resolved stylist recorded
    expect(row.items.map((i) => [i.serviceName, i.pricePaise, i.durationMin]).sort()).toEqual([
      ['colour', 400_000, 90],
      ['cut', 60_000, 60],
    ]);
  });

  it('offers slots that match the database: overrides, qualification and bookings', async () => {
    const day = '2026-11-23';
    // Colour is 90 min at this branch (override), so the last start is 17:30.
    expect((await slotTimes([ids.colour], ids.s1, day)).at(-1)).toBe('17:30');
    // s3 is not qualified for colour.
    const unqualified = await getAvailableSlots(
      port,
      { branchId: ids.branch, serviceIds: [ids.colour], date: day, stylistId: ids.s3 },
      opts,
    );
    expect(unqualified).toEqual({ ok: false, reason: 'STYLIST_NOT_ELIGIBLE' });
    // A service switched off at this branch.
    const off = await getAvailableSlots(
      port,
      { branchId: ids.branch, serviceIds: [ids.hidden], date: day, stylistId: 'ANY' },
      opts,
    );
    expect(off).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });

    // Book 10:00-11:00 and block 13:00-14:00 with time off: both vanish from s1's slots.
    await createAppointment(port, input({ startAt: ist('10:00', day) }), opts);
    await db.timeOff.create({
      data: { staffId: ids.s1, startAt: ist('13:00', day), endAt: ist('14:00', day) },
    });
    const t = await slotTimes([ids.cut], ids.s1, day);
    expect(t).not.toContain('10:00');
    expect(t).toContain('11:00'); // back-to-back is allowed
    expect(t).not.toContain('12:30');
    expect(t).not.toContain('13:00');
    expect(t).toContain('14:00');
  });

  it('back-to-back bookings are accepted by the database, and a cancelled one frees the slot', async () => {
    const day = '2026-11-24';
    const a = await createAppointment(port, input({ startAt: ist('10:00', day) }), opts);
    const b = await createAppointment(port, input({ startAt: ist('11:00', day) }), opts); // end == start
    expect(a.ok && b.ok).toBe(true);

    expect(await createAppointment(port, input({ startAt: ist('10:00', day) }), opts)).toEqual({
      ok: false,
      reason: 'SLOT_TAKEN',
    });
    if (a.ok)
      await db.appointment.update({
        where: { id: a.appointment.id },
        data: { status: 'CANCELLED' },
      });
    expect((await createAppointment(port, input({ startAt: ist('10:00', day) }), opts)).ok).toBe(
      true,
    );
  });

  it('enforces the per-phone cap against the database, and reuses the customer row', async () => {
    const phone = nextPhone();
    const book = (day: string) =>
      createAppointment(
        port,
        input({ startAt: ist('10:00', day), customer: { name: 'Same Person', phone } }),
        opts,
      );
    for (const day of ['2026-11-25', '2026-11-26', '2026-11-27'])
      expect((await book(day)).ok).toBe(true);
    expect(await book('2026-11-28')).toEqual({ ok: false, reason: 'PHONE_LIMIT_REACHED' });
    expect(await db.customer.count({ where: { phone } })).toBe(1);
  });

  it('serialises simultaneous bookings by one phone so the cap cannot be beaten', async () => {
    const phone = nextPhone();
    const days = [
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ];
    const results = await Promise.all(
      days.map((day) =>
        createAppointment(
          port,
          input({ startAt: ist('15:00', day), customer: { name: 'Racer', phone } }),
          opts,
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.reason === 'PHONE_LIMIT_REACHED')).toHaveLength(3);
  });
});
