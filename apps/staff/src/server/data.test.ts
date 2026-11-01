/**
 * The staff data layer against a real Postgres: two branches, every role, and bookings in both.
 * This is where "a receptionist at branch A cannot read or change branch B" is proven for real
 * (the rules themselves are in rules.test.ts). Creates its own uniquely named rows and removes them.
 */
import { createDb, type Db } from '@salon/db';
import { hashPassword, verifyPassword } from '@salon/db/password';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { Actor } from './access';
import {
  changeOwnPassword,
  changeStatus,
  createDeskBooking,
  getAppointment,
  getClient,
  getDeskSlots,
  getSchedule,
  getScheduleForDate,
  getStylistChoices,
  listBranches,
  listServices,
  listTeam,
  loadActor,
  searchClients,
  setTemporaryPassword,
} from './data';

config({
  path: fileURLToPath(new URL('../../../../packages/db/.env', import.meta.url)),
  quiet: true,
});
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url && process.env.CI) throw new Error('CI must provide DATABASE_URL for the Postgres tests');
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Refusing to run integration tests against a non-local database');
}

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const DAY = '2026-11-16'; // a Monday
const dayRange = (date: string) => ({
  from: ist(date, '00:00'),
  to: new Date(ist(date, '00:00').getTime() + 86_400_000),
});
const INITIAL_PASSWORD = 'initial-pass-123';

describe.skipIf(!url)('staff data layer on real Postgres', () => {
  let db: Db;
  const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const phones: string[] = [];
  const created = {
    branches: [] as string[],
    staff: [] as string[],
    services: [] as string[],
    category: '',
  };
  const ids = {} as Record<string, string>;
  const actors = {} as Record<string, Actor>;
  let dayCounter = 0;

  /** A booking for the test to use and change: its own date, so it never clashes with another. */
  async function makeAppointment(opts: {
    branch: 'A' | 'B';
    staff: string;
    customer: string;
    status?: 'CONFIRMED' | 'CHECKED_IN';
  }) {
    const date = new Date(Date.UTC(2027, 0, 4 + dayCounter++)).toISOString().slice(0, 10);
    const a = await db.appointment.create({
      data: {
        branchId: opts.branch === 'A' ? ids.branchA! : ids.branchB!,
        staffId: ids[opts.staff]!,
        customerId: ids[opts.customer]!,
        startAt: ist(date, '11:00'),
        endAt: ist(date, '12:00'),
        status: opts.status ?? 'CONFIRMED',
        source: 'ONLINE',
        stylistPreference: 'SPECIFIC',
        totalPricePaise: 60_000,
        totalDurationMin: 60,
        manageTokenHash: 'h',
        items: {
          create: [
            { serviceId: ids.cut!, serviceName: 'Haircut', pricePaise: 60_000, durationMin: 60 },
          ],
        },
      },
    });
    return a.id;
  }

  beforeAll(async () => {
    db = createDb(url!, 'pg');
    const hash = await hashPassword(INITIAL_PASSWORD);

    const mkBranch = async (key: 'A' | 'B') => {
      const b = await db.branch.create({
        data: {
          slug: `${tag}-${key.toLowerCase()}`,
          name: `${tag} Branch ${key}`,
          address: 'x',
          city: 'x',
          phone: '+910000000000',
          hours: Object.fromEntries(
            ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
              d,
              { open: '10:00', close: '20:00' },
            ]),
          ),
        },
      });
      created.branches.push(b.id);
      ids[`branch${key}`] = b.id;
    };
    await mkBranch('A');
    await mkBranch('B');

    const category = await db.serviceCategory.create({
      data: { slug: `${tag}-cat`, name: `${tag} cat` },
    });
    created.category = category.id;
    const mkService = async (key: string, price: number, min: number) => {
      const s = await db.service.create({
        data: {
          slug: `${tag}-${key}`,
          name: key === 'cut' ? 'Haircut' : 'Colour',
          categoryId: category.id,
          basePricePaise: price,
          baseDurationMin: min,
        },
      });
      created.services.push(s.id);
      ids[key] = s.id;
    };
    await mkService('cut', 60_000, 60);
    await mkService('colour', 300_000, 120);
    await db.branchService.createMany({
      data: [
        { branchId: ids.branchA!, serviceId: ids.cut! },
        { branchId: ids.branchA!, serviceId: ids.colour!, pricePaise: 320_000 },
        { branchId: ids.branchB!, serviceId: ids.cut!, durationMin: 50 },
      ],
    });

    const mkStaff = async (
      key: string,
      role: Actor['role'],
      branch: 'A' | 'B',
      bookable = false,
    ) => {
      const s = await db.staff.create({
        data: {
          name: key,
          email: `${tag}-${key}@example.invalid`,
          passwordHash: hash,
          role,
          homeBranchId: branch === 'A' ? ids.branchA! : ids.branchB!,
          bookable,
        },
      });
      created.staff.push(s.id);
      ids[key] = s.id;
      actors[key] = { id: s.id, name: key, role, homeBranchId: s.homeBranchId };
      if (bookable) {
        await db.staffService.createMany({ data: [{ staffId: s.id, serviceId: ids.cut! }] });
        await db.staffSchedule.createMany({
          data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            staffId: s.id,
            weekday,
            startMinute: 600,
            endMinute: 1140,
          })),
        });
      }
    };
    await mkStaff('owner', 'OWNER', 'A');
    await mkStaff('managerA', 'BRANCH_MANAGER', 'A');
    await mkStaff('managerA2', 'BRANCH_MANAGER', 'A');
    await mkStaff('recepA', 'RECEPTIONIST', 'A');
    await mkStaff('stylistA1', 'STYLIST', 'A', true);
    await mkStaff('stylistA2', 'STYLIST', 'A', true);
    await mkStaff('managerB', 'BRANCH_MANAGER', 'B');
    await mkStaff('recepB', 'RECEPTIONIST', 'B');
    await mkStaff('stylistB', 'STYLIST', 'B', true);

    const mkCustomer = async (key: string, phone: string, notes?: string) => {
      const c = await db.customer.create({ data: { name: `Customer ${key}`, phone, notes } });
      phones.push(phone);
      ids[key] = c.id;
    };
    // Digits are unique to this run so a search for them finds only these customers.
    const n = String(Date.now() % 1_0000_0000).padStart(8, '0');
    await mkCustomer('cA', `+9171${n.slice(0, 4)}1111`, 'PRIVATE NOTE: must never be returned');
    await mkCustomer('cB', `+9172${n.slice(0, 4)}2222`);
    await mkCustomer('cBoth', `+9173${n.slice(0, 4)}3333`);
    ids.n = n.slice(0, 4);

    // Fixed bookings on DAY: two at branch A (different stylists), two at branch B.
    const mk = async (
      branch: 'A' | 'B',
      staff: string,
      customer: string,
      from: string,
      to: string,
    ) =>
      (
        await db.appointment.create({
          data: {
            branchId: branch === 'A' ? ids.branchA! : ids.branchB!,
            staffId: ids[staff]!,
            customerId: ids[customer]!,
            startAt: ist(DAY, from),
            endAt: ist(DAY, to),
            status: 'CONFIRMED',
            source: 'ONLINE',
            stylistPreference: 'SPECIFIC',
            totalPricePaise: 60_000,
            totalDurationMin: 60,
            manageTokenHash: 'h',
            items: {
              create: [
                {
                  serviceId: ids.cut!,
                  serviceName: 'Haircut',
                  pricePaise: 60_000,
                  durationMin: 60,
                },
              ],
            },
          },
        })
      ).id;
    ids.apptA1 = await mk('A', 'stylistA1', 'cA', '11:00', '12:00');
    ids.apptA2 = await mk('A', 'stylistA2', 'cBoth', '12:00', '13:00');
    ids.apptB1 = await mk('B', 'stylistB', 'cB', '11:00', '12:00');
    ids.apptB2 = await mk('B', 'stylistB', 'cBoth', '14:00', '15:00');
  });

  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: { in: created.staff } } });
    await db.appointment.deleteMany({ where: { branchId: { in: created.branches } } }); // items cascade
    await db.customer.deleteMany({ where: { phone: { in: phones } } });
    await db.staffSchedule.deleteMany({ where: { staffId: { in: created.staff } } });
    await db.staffService.deleteMany({ where: { staffId: { in: created.staff } } });
    await db.staff.deleteMany({ where: { id: { in: created.staff } } });
    await db.branchService.deleteMany({ where: { serviceId: { in: created.services } } });
    await db.service.deleteMany({ where: { id: { in: created.services } } });
    await db.serviceCategory.deleteMany({ where: { id: created.category } });
    await db.branch.deleteMany({ where: { id: { in: created.branches } } });
    await db.$disconnect();
  });

  const statusOf = async (id: string) =>
    (await db.appointment.findUniqueOrThrow({ where: { id } })).status;

  describe('who is signed in', () => {
    it('reads role and branch from the database, and refuses a deactivated account', async () => {
      const found = await loadActor(db, ids.recepA!);
      expect(found?.actor).toEqual(actors.recepA);
      expect(found?.mustChangePassword).toBe(false);
      await db.staff.update({ where: { id: ids.recepA! }, data: { active: false } });
      expect(await loadActor(db, ids.recepA!)).toBeNull(); // takes effect immediately, not at session expiry
      await db.staff.update({ where: { id: ids.recepA! }, data: { active: true } });
      expect(await loadActor(db, 'does-not-exist')).toBeNull();
    });

    it('an owner lists every branch, everyone else only their own', async () => {
      const own = (await listBranches(db, actors.owner!)).map((b) => b.id);
      expect(own).toEqual(expect.arrayContaining([ids.branchA, ids.branchB]));
      expect((await listBranches(db, actors.recepA!)).map((b) => b.id)).toEqual([ids.branchA]);
      expect((await listBranches(db, actors.stylistB!)).map((b) => b.id)).toEqual([ids.branchB]);
    });
  });

  describe('the schedule', () => {
    const day = dayRange(DAY);
    const ofSchedule = async (
      actor: Actor,
      branchId: string,
      extra: { stylistId?: string } = {},
    ) => {
      const r = await getSchedule(db, actor, { branchId, ...day, ...extra });
      return r.ok ? r.appointments.map((a) => a.id).sort() : r.reason;
    };

    it("a receptionist sees their own branch's day and is FORBIDDEN from the other branch", async () => {
      expect(await ofSchedule(actors.recepA!, ids.branchA!)).toEqual(
        [ids.apptA1, ids.apptA2].sort(),
      );
      expect(await ofSchedule(actors.recepA!, ids.branchB!)).toBe('FORBIDDEN');
      expect(await ofSchedule(actors.recepB!, ids.branchA!)).toBe('FORBIDDEN');
      expect(await ofSchedule(actors.managerB!, ids.branchA!)).toBe('FORBIDDEN');
    });

    it('an owner sees either branch', async () => {
      expect(await ofSchedule(actors.owner!, ids.branchB!)).toEqual(
        [ids.apptB1, ids.apptB2].sort(),
      );
      expect(await ofSchedule(actors.owner!, ids.branchA!)).toEqual(
        [ids.apptA1, ids.apptA2].sort(),
      );
    });

    it('a stylist sees only their own bookings, even when they ask for a colleague', async () => {
      expect(await ofSchedule(actors.stylistA1!, ids.branchA!)).toEqual([ids.apptA1]);
      expect(
        await ofSchedule(actors.stylistA1!, ids.branchA!, { stylistId: ids.stylistA2! }),
      ).toEqual([]);
      expect(await ofSchedule(actors.stylistA1!, ids.branchB!)).toBe('FORBIDDEN');
      const r = await getSchedule(db, actors.stylistA1!, { branchId: ids.branchA!, ...day });
      if (!r.ok) throw new Error(r.reason);
      expect(r.stylists.map((s) => s.id)).toEqual([ids.stylistA1]); // only their own column
      expect(r.appointments[0]?.customerPhone).toBeNull(); // no phone for a stylist
      expect(r.appointments[0]?.customerName).toBe('Customer cA');
    });

    it('the front desk sees the customer phone, and the schedule never carries private notes', async () => {
      const r = await getSchedule(db, actors.recepA!, { branchId: ids.branchA!, ...day });
      if (!r.ok) throw new Error(r.reason);
      expect(r.appointments.find((a) => a.id === ids.apptA1)?.customerPhone).toMatch(/^\+9171/);
      expect(JSON.stringify(r)).not.toContain('PRIVATE NOTE');
      expect(JSON.stringify(r)).not.toContain('notes');
    });

    it('filters by stylist, and returns the stylists as columns', async () => {
      const r = await getSchedule(db, actors.recepA!, {
        branchId: ids.branchA!,
        ...day,
        stylistId: ids.stylistA2!,
      });
      if (!r.ok) throw new Error(r.reason);
      expect(r.appointments.map((a) => a.id)).toEqual([ids.apptA2]);
      expect(r.stylists.map((s) => s.name)).toEqual(['stylistA2']);
    });
  });

  describe('the schedule by day and week, in the branch timezone', () => {
    const ids_ = (r: Awaited<ReturnType<typeof getScheduleForDate>>) =>
      r.ok ? r.appointments.map((a) => a.id).sort() : r.reason;

    it('a day is the branch own day and a week runs Monday to Sunday', async () => {
      const day = await getScheduleForDate(db, actors.recepA!, {
        branchId: ids.branchA!,
        date: DAY,
        view: 'day',
      });
      expect(ids_(day)).toEqual([ids.apptA1, ids.apptA2].sort());
      // Wednesday of the same week: the week view starts on Monday the 16th and still includes it.
      const week = await getScheduleForDate(db, actors.recepA!, {
        branchId: ids.branchA!,
        date: '2026-11-18',
        view: 'week',
      });
      if (!week.ok) throw new Error(week.reason);
      expect(week.range).toEqual({ startDate: '2026-11-16', days: 7 });
      expect(ids_(week)).toEqual([ids.apptA1, ids.apptA2].sort());
      // Sunday the 22nd is the same week; Monday the 23rd is the next one.
      const sunday = await getScheduleForDate(db, actors.recepA!, {
        branchId: ids.branchA!,
        date: '2026-11-22',
        view: 'week',
      });
      const nextMonday = await getScheduleForDate(db, actors.recepA!, {
        branchId: ids.branchA!,
        date: '2026-11-23',
        view: 'week',
      });
      expect(sunday.ok && sunday.range.startDate).toBe('2026-11-16');
      expect(nextMonday.ok && nextMonday.range.startDate).toBe('2026-11-23');
      expect(ids_(nextMonday)).toEqual([]);
    });

    it('the day boundary is branch midnight: a 23:30 booking belongs to its own day, not the next', async () => {
      const lateDate = '2027-03-10';
      const late = await db.appointment.create({
        data: {
          branchId: ids.branchA!,
          staffId: ids.stylistA1!,
          customerId: ids.cA!,
          startAt: ist(lateDate, '23:00'),
          endAt: ist(lateDate, '23:45'),
          status: 'CONFIRMED',
          source: 'PHONE',
          stylistPreference: 'SPECIFIC',
          totalPricePaise: 1,
          totalDurationMin: 45,
          manageTokenHash: 'h',
        },
      });
      const same = await getScheduleForDate(db, actors.owner!, {
        branchId: ids.branchA!,
        date: lateDate,
        view: 'day',
      });
      const next = await getScheduleForDate(db, actors.owner!, {
        branchId: ids.branchA!,
        date: '2027-03-11',
        view: 'day',
      });
      expect(ids_(same)).toEqual([late.id]);
      expect(ids_(next)).toEqual([]);
    });

    it('applies the same branch scope, and refuses bad dates', async () => {
      expect(
        ids_(
          await getScheduleForDate(db, actors.recepA!, {
            branchId: ids.branchB!,
            date: DAY,
            view: 'day',
          }),
        ),
      ).toBe('FORBIDDEN');
      expect(
        ids_(
          await getScheduleForDate(db, actors.stylistA1!, {
            branchId: ids.branchA!,
            date: DAY,
            view: 'week',
          }),
        ),
      ).toEqual([ids.apptA1]);
      for (const date of ['2026-13-40', 'tomorrow', '16-11-2026', '']) {
        expect(
          await getScheduleForDate(db, actors.owner!, {
            branchId: ids.branchA!,
            date,
            view: 'day',
          }),
          date,
        ).toEqual({ ok: false, reason: 'INVALID_INPUT' });
      }
    });
  });

  describe('one appointment', () => {
    it('reveals nothing about another branch: an existing appointment looks exactly like a missing one', async () => {
      expect(await getAppointment(db, actors.recepA!, ids.apptB1!)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
      expect(await getAppointment(db, actors.recepA!, 'no-such-id')).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
      expect(await getAppointment(db, actors.stylistA1!, ids.apptA2!)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      }); // colleague
      expect((await getAppointment(db, actors.owner!, ids.apptB1!)).ok).toBe(true);
    });

    it('gives the front desk the details, and a stylist theirs without the phone', async () => {
      const desk = await getAppointment(db, actors.recepA!, ids.apptA1!);
      if (!desk.ok) throw new Error(desk.reason);
      expect(desk.appointment).toMatchObject({
        customerName: 'Customer cA',
        staffName: 'stylistA1',
        totalPricePaise: 60_000,
        services: ['Haircut'],
      });
      expect(desk.appointment.customerPhone).toMatch(/^\+9171/);
      const own = await getAppointment(db, actors.stylistA1!, ids.apptA1!);
      if (!own.ok) throw new Error(own.reason);
      expect(own.appointment.customerPhone).toBeNull();
    });
  });

  describe('changing a status', () => {
    it("cannot touch another branch's appointment, and nothing changes", async () => {
      const id = await makeAppointment({ branch: 'B', staff: 'stylistB', customer: 'cB' });
      for (const to of ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'] as const) {
        expect(await changeStatus(db, actors.recepA!, id, to)).toEqual({
          ok: false,
          reason: 'NOT_FOUND',
        });
        expect(await changeStatus(db, actors.managerA!, id, to)).toEqual({
          ok: false,
          reason: 'NOT_FOUND',
        });
      }
      expect(await statusOf(id)).toBe('CONFIRMED');
      expect(await db.auditLog.count({ where: { appointmentId: id } })).toBe(0);
    });

    it('a stylist cannot change anything, not even their own booking', async () => {
      const id = await makeAppointment({ branch: 'A', staff: 'stylistA1', customer: 'cA' });
      expect(await changeStatus(db, actors.stylistA1!, id, 'CHECKED_IN')).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(await statusOf(id)).toBe('CONFIRMED');
    });

    it('checks in then completes, writing an audit entry for each step', async () => {
      const id = await makeAppointment({ branch: 'A', staff: 'stylistA1', customer: 'cA' });
      expect(await changeStatus(db, actors.recepA!, id, 'CHECKED_IN')).toEqual({
        ok: true,
        from: 'CONFIRMED',
        to: 'CHECKED_IN',
      });
      expect(await changeStatus(db, actors.recepA!, id, 'COMPLETED')).toEqual({
        ok: true,
        from: 'CHECKED_IN',
        to: 'COMPLETED',
      });
      expect(await statusOf(id)).toBe('COMPLETED');
      const audit = await db.auditLog.findMany({
        where: { appointmentId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => [a.action, a.actorId, a.detail])).toEqual([
        ['STATUS_CHANGE', ids.recepA, { from: 'CONFIRMED', to: 'CHECKED_IN' }],
        ['STATUS_CHANGE', ids.recepA, { from: 'CHECKED_IN', to: 'COMPLETED' }],
      ]);
      // Finished is finished.
      expect(await changeStatus(db, actors.owner!, id, 'CANCELLED')).toEqual({
        ok: false,
        reason: 'INVALID_TRANSITION',
      });
    });

    it('shows the history in the appointment detail, with who did it', async () => {
      const id = await makeAppointment({ branch: 'A', staff: 'stylistA1', customer: 'cA' });
      await changeStatus(db, actors.managerA!, id, 'NO_SHOW');
      const detail = await getAppointment(db, actors.recepA!, id);
      if (!detail.ok) throw new Error(detail.reason);
      expect(detail.appointment.audit).toEqual([
        expect.objectContaining({
          action: 'STATUS_CHANGE',
          actorName: 'managerA',
          detail: { from: 'CONFIRMED', to: 'NO_SHOW' },
        }),
      ]);
    });

    it('two people pressing different buttons at once: exactly one wins', async () => {
      const id = await makeAppointment({ branch: 'A', staff: 'stylistA1', customer: 'cA' });
      const results = await Promise.all([
        changeStatus(db, actors.recepA!, id, 'CANCELLED'),
        changeStatus(db, actors.managerA!, id, 'CHECKED_IN'),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok);
      expect(['CONFLICT', 'INVALID_TRANSITION']).toContain((loser as { reason: string }).reason);
      expect(await db.auditLog.count({ where: { appointmentId: id } })).toBe(1);
      const winner = results.find((r) => r.ok) as { to: string };
      expect(await statusOf(id)).toBe(winner.to);
    });

    it('cancelling frees the slot at once, so the same time can be booked again', async () => {
      const startAt = ist('2027-02-01', '11:00');
      const options = { now: ist('2027-01-31', '10:00') };
      const book = (phone: string) =>
        createDeskBooking(
          db,
          actors.recepA!,
          {
            branchId: ids.branchA!,
            serviceIds: [ids.cut!],
            startAt,
            stylistId: ids.stylistA1!,
            name: 'Slot Test',
            phone,
            source: 'PHONE',
          },
          options,
        );
      const first = await book('98765 41001');
      phones.push('+919876541001');
      if (!first.ok) throw new Error(first.reason);
      expect(await book('98765 41002')).toEqual({ ok: false, reason: 'SLOT_TAKEN' });
      expect(
        await changeStatus(db, actors.recepA!, first.appointment.id, 'CANCELLED'),
      ).toMatchObject({ ok: true });
      const again = await book('98765 41002');
      phones.push('+919876541002');
      expect(again.ok).toBe(true);
    });
  });

  describe('booking at the desk (same engine as the website)', () => {
    const now = { now: ist('2026-12-07', '10:00') };
    const base = {
      serviceIds: [] as string[],
      stylistId: 'ANY',
      name: 'Walk In',
      phone: '98765 42001',
      source: 'WALK_IN' as const,
    };

    it("lists services with the branch's own price and time, and refuses another branch", async () => {
      const r = await listServices(db, actors.recepA!, ids.branchA!);
      if (!r.ok) throw new Error(r.reason);
      expect(r.services.map((s) => [s.name, s.pricePaise, s.durationMin])).toEqual([
        ['Haircut', 60_000, 60],
        ['Colour', 320_000, 120],
      ]);
      const b = await listServices(db, actors.owner!, ids.branchB!);
      if (!b.ok) throw new Error(b.reason);
      expect(b.services.map((s) => [s.name, s.durationMin])).toEqual([['Haircut', 50]]); // Branch B override
      expect(await listServices(db, actors.recepA!, ids.branchB!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(await listServices(db, actors.stylistA1!, ids.branchA!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
    });

    it('a receptionist cannot book at another branch, and a stylist cannot book at all', async () => {
      const input = {
        ...base,
        branchId: ids.branchB!,
        serviceIds: [ids.cut!],
        startAt: ist('2026-12-07', '15:00'),
      };
      expect(await createDeskBooking(db, actors.recepA!, input, now)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(await createDeskBooking(db, actors.stylistB!, input, now)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(
        await getStylistChoices(db, actors.recepA!, {
          branchId: ids.branchB!,
          serviceIds: [ids.cut!],
        }),
      ).toEqual({ ok: false, reason: 'FORBIDDEN' });
      expect(
        await getDeskSlots(db, actors.recepA!, {
          branchId: ids.branchB!,
          serviceIds: [ids.cut!],
          date: '2026-12-07',
          stylistId: 'ANY',
        }),
      ).toEqual({ ok: false, reason: 'FORBIDDEN' });
      expect(
        await db.appointment.count({
          where: { branchId: ids.branchB!, startAt: ist('2026-12-07', '15:00') },
        }),
      ).toBe(0);
    });

    it('books a walk-in for right now (off the grid, no notice), records the source and audits it', async () => {
      const r = await createDeskBooking(
        db,
        actors.recepA!,
        {
          ...base,
          branchId: ids.branchA!,
          serviceIds: [ids.cut!],
          startAt: ist('2026-12-07', '15:07'),
        },
        { now: ist('2026-12-07', '15:07') },
      );
      phones.push('+919876542001');
      if (!r.ok) throw new Error(r.reason);
      const row = await db.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } });
      expect(row).toMatchObject({
        source: 'WALK_IN',
        status: 'CONFIRMED',
        stylistPreference: 'ANY_AVAILABLE',
        totalPricePaise: 60_000,
      });
      expect(row.startAt).toEqual(ist('2026-12-07', '15:07'));
      const audit = await db.auditLog.findMany({ where: { appointmentId: r.appointment.id } });
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'CREATE_BOOKING',
          actorId: ids.recepA,
          detail: { source: 'WALK_IN' },
        }),
      ]);
    });

    it('a phone booking may use a landline number, which the website would refuse', async () => {
      const r = await createDeskBooking(
        db,
        actors.managerA!,
        {
          ...base,
          branchId: ids.branchA!,
          serviceIds: [ids.cut!],
          startAt: ist('2026-12-08', '12:00'),
          phone: '080 2345 6789',
          source: 'PHONE',
        },
        { now: ist('2026-12-07', '10:00') },
      );
      phones.push('+918023456789');
      expect(r.ok).toBe(true);
    });

    it('shows staff the free times for any date, and the stylists for the chosen services', async () => {
      const slots = await getDeskSlots(
        db,
        actors.recepA!,
        { branchId: ids.branchA!, serviceIds: [ids.cut!], date: '2027-06-07', stylistId: 'ANY' },
        { now: ist('2026-12-07', '10:00') },
      );
      if (!slots.ok) throw new Error(slots.reason);
      expect(slots.slots.length).toBeGreaterThan(50); // months ahead: the website would refuse this date
      const choices = await getStylistChoices(db, actors.recepA!, {
        branchId: ids.branchA!,
        serviceIds: [ids.cut!],
      });
      if (!choices.ok) throw new Error(choices.reason);
      expect(choices.stylists.map((s) => s.name)).toEqual(['stylistA1', 'stylistA2']);
    });
  });

  describe('clients', () => {
    const digits = (key: 'cA' | 'cB' | 'cBoth') =>
      ({ cA: `71${ids.n}1111`, cB: `72${ids.n}2222`, cBoth: `73${ids.n}3333` })[key];

    it('a stylist cannot look clients up', async () => {
      expect(await searchClients(db, actors.stylistA1!, '9171')).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(await getClient(db, actors.stylistA1!, ids.cA!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
    });

    it('the front desk finds customers who have been to THEIR branch only', async () => {
      const find = async (actor: Actor, key: 'cA' | 'cB' | 'cBoth') => {
        const r = await searchClients(db, actor, digits(key));
        return r.ok ? r.clients.map((c) => c.id) : r.reason;
      };
      expect(await find(actors.recepA!, 'cA')).toEqual([ids.cA]);
      expect(await find(actors.recepA!, 'cBoth')).toEqual([ids.cBoth]);
      expect(await find(actors.recepA!, 'cB')).toEqual([]); // only ever visited branch B
      expect(await find(actors.recepB!, 'cB')).toEqual([ids.cB]);
      expect(await find(actors.recepB!, 'cA')).toEqual([]);
      expect(await find(actors.owner!, 'cB')).toEqual([ids.cB]); // owners see everyone
    });

    it('counts and dates only the visits the person may see', async () => {
      const a = await searchClients(db, actors.recepA!, digits('cBoth'));
      const b = await searchClients(db, actors.recepB!, digits('cBoth'));
      const o = await searchClients(db, actors.owner!, digits('cBoth'));
      if (!a.ok || !b.ok || !o.ok) throw new Error('search failed');
      expect([a.clients[0]?.visits, b.clients[0]?.visits, o.clients[0]?.visits]).toEqual([1, 1, 2]);
      expect(a.clients[0]?.lastVisit).toBe(ist(DAY, '12:00').toISOString());
      expect(b.clients[0]?.lastVisit).toBe(ist(DAY, '14:00').toISOString());
    });

    it('ignores spaces, dashes and a leading 0, and wants at least 4 digits', async () => {
      const spaced = `${digits('cA').slice(0, 4)} ${digits('cA').slice(4)}`;
      const r = await searchClients(db, actors.recepA!, `0${spaced}`.replace(/^0(\d)/, '0-$1'));
      expect(r.ok && r.clients.map((c) => c.id)).toEqual([ids.cA]);
      expect(await searchClients(db, actors.recepA!, '917')).toEqual({
        ok: true,
        clients: [],
        tooShort: true,
      });
    });

    it("shows the visit history, limited to the person's own branch, and never the notes", async () => {
      const a = await getClient(db, actors.recepA!, ids.cBoth!);
      const o = await getClient(db, actors.owner!, ids.cBoth!);
      if (!a.ok || !o.ok) throw new Error('lookup failed');
      expect(a.client.history.map((h) => h.id)).toEqual([ids.apptA2]);
      expect(o.client.history.map((h) => h.id).sort()).toEqual([ids.apptA2, ids.apptB2].sort());
      expect(a.client.history[0]).toMatchObject({
        branchName: `${tag} Branch A`,
        staffName: 'stylistA2',
        services: ['Haircut'],
      });
      const withNotes = await getClient(db, actors.owner!, ids.cA!);
      expect(JSON.stringify(withNotes)).not.toContain('PRIVATE NOTE');
      expect(JSON.stringify(await searchClients(db, actors.owner!, digits('cA')))).not.toContain(
        'PRIVATE NOTE',
      );
    });

    it('a customer from another branch is NOT_FOUND, exactly like a missing one', async () => {
      expect(await getClient(db, actors.recepA!, ids.cB!)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
      expect(await getClient(db, actors.recepA!, 'no-such-id')).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
    });
  });

  describe('team and passwords', () => {
    it('lists the team: owner everyone, manager their own branch, others nothing', async () => {
      const mine = async (actor: Actor) => {
        const r = await listTeam(db, actor);
        return r.ok
          ? r.team
              .filter((t) => t.email.startsWith(tag))
              .map((t) => t.name)
              .sort()
          : r.reason;
      };
      expect(await mine(actors.managerA!)).toEqual([
        'managerA',
        'managerA2',
        'owner',
        'recepA',
        'stylistA1',
        'stylistA2',
      ]);
      expect(await mine(actors.managerB!)).toEqual(['managerB', 'recepB', 'stylistB']);
      expect((await mine(actors.owner!)) as string[]).toHaveLength(9);
      expect(await mine(actors.recepA!)).toBe('FORBIDDEN');
      expect(await mine(actors.stylistA1!)).toBe('FORBIDDEN');
    });

    it('marks who the person is allowed to reset', async () => {
      const r = await listTeam(db, actors.managerA!);
      if (!r.ok) throw new Error(r.reason);
      const can = Object.fromEntries(
        r.team.filter((t) => t.email.startsWith(tag)).map((t) => [t.name, t.canReset]),
      );
      expect(can).toMatchObject({
        recepA: true,
        stylistA1: true,
        stylistA2: true,
        managerA2: false,
        managerA: false,
        owner: false,
      });
    });

    it('a manager sets a one-time password for their own receptionist, who must then change it', async () => {
      const r = await setTemporaryPassword(db, actors.managerA!, ids.recepA!);
      if (!r.ok) throw new Error(r.reason);
      expect(r.password).toHaveLength(14);
      const row = await db.staff.findUniqueOrThrow({ where: { id: ids.recepA! } });
      expect(row.mustChangePassword).toBe(true);
      expect(await verifyPassword(r.password, row.passwordHash)).toBe(true);
      expect(await verifyPassword(INITIAL_PASSWORD, row.passwordHash)).toBe(false); // the old one stops working
      const audit = await db.auditLog.findMany({
        where: { actorId: ids.managerA!, action: 'PASSWORD_RESET' },
      });
      expect(audit[0]?.detail).toEqual({ targetStaffId: ids.recepA });
      expect(JSON.stringify(audit)).not.toContain(r.password); // the password is never logged
    });

    it('refuses everything a manager must not do, and changes nothing', async () => {
      const before = (
        await db.staff.findMany({
          where: { id: { in: created.staff } },
          select: { id: true, passwordHash: true },
        })
      )
        .map((s) => s.passwordHash)
        .join();
      expect(await setTemporaryPassword(db, actors.managerA!, ids.recepB!)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      }); // other branch
      expect(await setTemporaryPassword(db, actors.managerA!, ids.managerA2!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      }); // an equal
      expect(await setTemporaryPassword(db, actors.managerA!, ids.owner!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      }); // more powerful
      expect(await setTemporaryPassword(db, actors.managerA!, ids.managerA!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      }); // themselves
      expect(await setTemporaryPassword(db, actors.recepA!, ids.stylistA1!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      expect(await setTemporaryPassword(db, actors.stylistA1!, ids.recepA!)).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
      const after = (
        await db.staff.findMany({
          where: { id: { in: created.staff } },
          select: { id: true, passwordHash: true },
        })
      )
        .map((s) => s.passwordHash)
        .join();
      expect(after).toBe(before);
    });

    it('an owner can reset a manager at any branch', async () => {
      expect((await setTemporaryPassword(db, actors.owner!, ids.managerB!)).ok).toBe(true);
    });

    it('a person changes their own password: needs the current one, a strong new one, and it clears the flag', async () => {
      await db.staff.update({ where: { id: ids.stylistA2! }, data: { mustChangePassword: true } });
      const me = actors.stylistA2!;
      expect(
        await changeOwnPassword(db, me, { current: 'not-my-password', next: 'a-brand-new-pass-1' }),
      ).toEqual({ ok: false, reason: 'WRONG_PASSWORD' });
      expect(
        await changeOwnPassword(db, me, { current: INITIAL_PASSWORD, next: 'short' }),
      ).toMatchObject({ ok: false, reason: 'WEAK_PASSWORD' });
      expect(
        await changeOwnPassword(db, me, { current: INITIAL_PASSWORD, next: INITIAL_PASSWORD }),
      ).toMatchObject({ ok: false, reason: 'WEAK_PASSWORD' });
      expect((await db.staff.findUniqueOrThrow({ where: { id: me.id } })).mustChangePassword).toBe(
        true,
      ); // nothing changed yet
      expect(
        await changeOwnPassword(db, me, { current: INITIAL_PASSWORD, next: 'a-brand-new-pass-1' }),
      ).toEqual({ ok: true });
      const row = await db.staff.findUniqueOrThrow({ where: { id: me.id } });
      expect(row.mustChangePassword).toBe(false);
      expect(await verifyPassword('a-brand-new-pass-1', row.passwordHash)).toBe(true);
      expect(await verifyPassword(INITIAL_PASSWORD, row.passwordHash)).toBe(false);
      expect(
        await db.auditLog.count({ where: { actorId: me.id, action: 'PASSWORD_CHANGE' } }),
      ).toBe(1);
    });
  });
});
