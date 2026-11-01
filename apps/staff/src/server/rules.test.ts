import { createMemoryStore, createRateLimiter, hashId } from '@salon/security/rate-limit';
import { hashPassword, verifyPassword } from '@salon/db/password';
import { describe, expect, it, vi } from 'vitest';
import {
  allowedTransitions,
  appointmentScope,
  canChangeStatus,
  canCreateBooking,
  canManageTeam,
  canResetPassword,
  canSearchClients,
  canViewAppointment,
  canViewBranch,
  teamScope,
  type Actor,
  type AppointmentStatus,
  type TargetStatus,
} from './access';
import { DUMMY_HASH, LOGIN_LIMITS, attemptLogin, type LoginDeps } from './login';
import { checkNewPassword } from './password-policy';

// Two branches, A and B, and one person of each role at A (plus a second stylist and a manager at B).
const A = 'branch-a';
const B = 'branch-b';
const actor = (id: string, role: Actor['role'], homeBranchId: string): Actor => ({
  id,
  name: id,
  role,
  homeBranchId,
});
const owner = actor('owner', 'OWNER', A);
const managerA = actor('manager-a', 'BRANCH_MANAGER', A);
const managerA2 = actor('manager-a2', 'BRANCH_MANAGER', A);
const receptionistA = actor('recep-a', 'RECEPTIONIST', A);
const stylistA = actor('stylist-a', 'STYLIST', A);
const receptionistB = actor('recep-b', 'RECEPTIONIST', B);
const managerB = actor('manager-b', 'BRANCH_MANAGER', B);

const apptAt = (branchId: string, staffId: string) => ({ branchId, staffId });

describe('who can see which appointments', () => {
  it('owner sees everything; managers and receptionists only their own branch', () => {
    for (const a of [apptAt(A, 'x'), apptAt(B, 'x')])
      expect(canViewAppointment(owner, a)).toBe(true);
    for (const person of [managerA, receptionistA]) {
      expect(canViewAppointment(person, apptAt(A, 'someone'))).toBe(true);
      expect(canViewAppointment(person, apptAt(B, 'someone'))).toBe(false);
    }
    expect(canViewAppointment(receptionistB, apptAt(A, 'someone'))).toBe(false);
    expect(canViewAppointment(managerB, apptAt(A, 'someone'))).toBe(false);
  });

  it("a stylist sees only their own appointments, never a colleague's or another branch's", () => {
    expect(canViewAppointment(stylistA, apptAt(A, 'stylist-a'))).toBe(true);
    expect(canViewAppointment(stylistA, apptAt(A, 'stylist-a2'))).toBe(false); // colleague, same branch
    expect(canViewAppointment(stylistA, apptAt(B, 'stylist-a'))).toBe(false); // wrong branch
  });

  it('gives the database filter that matches, so out-of-scope rows are never fetched', () => {
    expect(appointmentScope(owner)).toEqual({});
    expect(appointmentScope(managerA)).toEqual({ branchId: A });
    expect(appointmentScope(receptionistB)).toEqual({ branchId: B });
    expect(appointmentScope(stylistA)).toEqual({ branchId: A, staffId: 'stylist-a' });
  });

  it('branch visibility follows the same rule', () => {
    expect(canViewBranch(owner, A)).toBe(true);
    expect(canViewBranch(owner, B)).toBe(true);
    expect(canViewBranch(receptionistA, A)).toBe(true);
    expect(canViewBranch(receptionistA, B)).toBe(false);
    expect(canViewBranch(stylistA, B)).toBe(false);
  });
});

describe("changing an appointment's status", () => {
  const statuses: AppointmentStatus[] = [
    'PENDING',
    'CONFIRMED',
    'CHECKED_IN',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ];

  it('allows only the sensible moves, and finished appointments stay finished', () => {
    expect(allowedTransitions('CONFIRMED')).toEqual(['CHECKED_IN', 'CANCELLED', 'NO_SHOW']);
    expect(allowedTransitions('PENDING')).toEqual(['CHECKED_IN', 'CANCELLED', 'NO_SHOW']);
    expect(allowedTransitions('CHECKED_IN')).toEqual(['COMPLETED', 'CANCELLED']);
    for (const done of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(allowedTransitions(done)).toEqual([]);
    }
    expect(statuses.length).toBe(6);
  });

  it('front desk may make a valid move on a visible appointment', () => {
    for (const person of [owner, managerA, receptionistA]) {
      expect(
        canChangeStatus(person, { ...apptAt(A, 's'), status: 'CONFIRMED' }, 'CHECKED_IN'),
      ).toEqual({ ok: true });
      expect(
        canChangeStatus(person, { ...apptAt(A, 's'), status: 'CHECKED_IN' }, 'COMPLETED'),
      ).toEqual({ ok: true });
    }
  });

  it('refuses an invalid move with INVALID_TRANSITION', () => {
    const bad: [AppointmentStatus, TargetStatus][] = [
      ['COMPLETED', 'CANCELLED'],
      ['CANCELLED', 'CHECKED_IN'],
      ['NO_SHOW', 'COMPLETED'],
      ['CHECKED_IN', 'NO_SHOW'], // they turned up
      ['CONFIRMED', 'COMPLETED'], // must check in first
    ];
    for (const [from, to] of bad) {
      expect(
        canChangeStatus(receptionistA, { ...apptAt(A, 's'), status: from }, to),
        `${from} -> ${to}`,
      ).toEqual({
        ok: false,
        reason: 'INVALID_TRANSITION',
      });
    }
  });

  it("refuses another branch's appointment even for a valid move (cross-branch)", () => {
    for (const person of [receptionistA, managerA, receptionistB, managerB]) {
      const other = person.homeBranchId === A ? B : A;
      expect(
        canChangeStatus(person, { ...apptAt(other, 's'), status: 'CONFIRMED' }, 'CANCELLED'),
      ).toEqual({
        ok: false,
        reason: 'FORBIDDEN',
      });
    }
  });

  it('a stylist can never change a status, not even their own appointment', () => {
    expect(
      canChangeStatus(stylistA, { ...apptAt(A, 'stylist-a'), status: 'CONFIRMED' }, 'CHECKED_IN'),
    ).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    });
  });
});

describe('the other front-desk and team powers', () => {
  it('booking: owner anywhere; managers and receptionists only at their branch; stylists never', () => {
    expect(canCreateBooking(owner, B)).toBe(true);
    expect(canCreateBooking(managerA, A)).toBe(true);
    expect(canCreateBooking(managerA, B)).toBe(false);
    expect(canCreateBooking(receptionistA, A)).toBe(true);
    expect(canCreateBooking(receptionistA, B)).toBe(false);
    expect(canCreateBooking(stylistA, A)).toBe(false);
  });

  it('client search is for the front desk only', () => {
    expect([owner, managerA, receptionistA].map(canSearchClients)).toEqual([true, true, true]);
    expect(canSearchClients(stylistA)).toBe(false);
  });

  it('only owners and managers manage the team', () => {
    expect([owner, managerA].map(canManageTeam)).toEqual([true, true]);
    expect([receptionistA, stylistA].map(canManageTeam)).toEqual([false, false]);
    expect(teamScope(owner)).toEqual({});
    expect(teamScope(managerA)).toEqual({ homeBranchId: A });
  });

  it('password reset: an owner for anyone but themselves', () => {
    expect(canResetPassword(owner, managerB)).toBe(true);
    expect(canResetPassword(owner, receptionistA)).toBe(true);
    expect(canResetPassword(owner, owner)).toBe(false);
  });

  it('password reset: a manager only for receptionists and stylists of their own branch', () => {
    expect(canResetPassword(managerA, receptionistA)).toBe(true);
    expect(canResetPassword(managerA, stylistA)).toBe(true);
    expect(canResetPassword(managerA, managerA2)).toBe(false); // an equal
    expect(canResetPassword(managerA, owner)).toBe(false); // a more powerful account
    expect(canResetPassword(managerA, receptionistB)).toBe(false); // another branch
    expect(canResetPassword(managerA, managerA)).toBe(false); // themselves
  });

  it('password reset: receptionists and stylists can reset nobody', () => {
    expect(canResetPassword(receptionistA, stylistA)).toBe(false);
    expect(canResetPassword(stylistA, receptionistA)).toBe(false);
  });
});

describe('choosing a new password', () => {
  it('needs 10+ characters and some variety', () => {
    expect(checkNewPassword('short')).toMatch(/at least 10/);
    expect(checkNewPassword('aaaaaaaaaaaa')).toMatch(/different characters/);
    expect(checkNewPassword('x'.repeat(129) + 'abc')).toMatch(/at most 128/);
    expect(checkNewPassword('correct horse battery')).toBeNull();
  });

  it('must differ from the current password and not contain the email', () => {
    expect(checkNewPassword('Same-pass-123', { current: 'Same-pass-123' })).toMatch(/different/);
    expect(checkNewPassword('priya.sharma@salon.in', { email: 'priya.sharma@salon.in' })).toMatch(
      /email/,
    );
    expect(checkNewPassword('my-priya.sharma-pass', { email: 'priya.sharma@salon.in' })).toMatch(
      /email/,
    );
    expect(
      checkNewPassword('Fresh-pass-456', { current: 'Old-pass-123', email: 'a@b.in' }),
    ).toBeNull();
  });
});

describe('staff sign-in', () => {
  const PASSWORD = 'right-password-1';
  type StaffRow = NonNullable<Awaited<ReturnType<LoginDeps['findStaff']>>>;

  function setup(extra: Partial<StaffRow>[] = []) {
    const clock = { ms: 1_000_000_000 };
    const staff: StaffRow[] = [
      {
        id: 's1',
        email: 'asha@salon.in',
        name: 'Asha',
        passwordHash: `plain:${PASSWORD}`,
        active: true,
      },
      {
        id: 's2',
        email: 'gone@salon.in',
        name: 'Gone',
        passwordHash: `plain:${PASSWORD}`,
        active: false,
      },
      ...extra.map((e, i) => ({
        id: `x${i}`,
        email: `x${i}@salon.in`,
        name: 'X',
        passwordHash: `plain:${PASSWORD}`,
        active: true,
        ...e,
      })),
    ];
    const verifyPasswordFake = vi.fn(
      async (password: string, hash: string) => hash === `plain:${password}`,
    );
    const deps = {
      limiter: createRateLimiter(
        createMemoryStore(() => clock.ms),
        { now: () => clock.ms },
      ),
      verifyTurnstile: vi.fn(async () => ({ ok: true as const })) as LoginDeps['verifyTurnstile'] &
        ReturnType<typeof vi.fn>,
      findStaff: vi.fn(async (email: string) => staff.find((s) => s.email === email) ?? null),
      verifyPassword: verifyPasswordFake,
      hashId,
      log: vi.fn(),
    } satisfies LoginDeps;
    const login = (email: string, password: string, ip = '203.0.113.7', token = 'tok') =>
      attemptLogin({ email, password, turnstileToken: token }, ip, deps);
    return { deps, login, clock };
  }

  it('signs in with the right email and password, ignoring case and spaces in the email', async () => {
    const { login } = setup();
    expect(await login('asha@salon.in', PASSWORD)).toEqual({
      ok: true,
      staff: { id: 's1', email: 'asha@salon.in', name: 'Asha' },
    });
    expect((await login('  ASHA@Salon.IN ', PASSWORD)).ok).toBe(true);
  });

  it('says only "invalid" for a wrong password, an unknown email, and a deactivated account', async () => {
    const { login } = setup();
    expect(await login('asha@salon.in', 'wrong')).toEqual({ ok: false, reason: 'invalid' });
    expect(await login('nobody@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'invalid' });
    expect(await login('gone@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'invalid' }); // right password, but inactive
  });

  it('checks a password even for an unknown email, so timing does not reveal which emails exist', async () => {
    const { login, deps } = setup();
    await login('nobody@salon.in', 'whatever');
    expect(deps.verifyPassword).toHaveBeenCalledWith('whatever', DUMMY_HASH);
  });

  it('the dummy hash is a real hash: checking it costs a full PBKDF2 run and never matches', async () => {
    const started = performance.now();
    expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false);
    const dummyMs = performance.now() - started;
    const real = await hashPassword('right');
    const t2 = performance.now();
    await verifyPassword('wrong', real);
    const realMs = performance.now() - t2;
    // Same work (same iteration count), so the same order of time.
    expect(dummyMs).toBeGreaterThan(realMs / 5);
  });

  it('locks after 5 failed attempts for that email from that address, even for the right password', async () => {
    const { login } = setup();
    for (let i = 0; i < LOGIN_LIMITS.failures.limit; i++) {
      expect((await login('asha@salon.in', `wrong${i}`)).ok).toBe(false);
    }
    expect(await login('asha@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'locked' });
  });

  it('the lock is per email + address: another address, or another email, is not locked', async () => {
    const { login } = setup([{ email: 'bina@salon.in' }]);
    for (let i = 0; i < 5; i++) await login('asha@salon.in', 'wrong');
    expect((await login('asha@salon.in', PASSWORD, '198.51.100.9')).ok).toBe(true); // other address
    expect((await login('bina@salon.in', PASSWORD)).ok).toBe(true); // other email, same address
  });

  it('only FAILURES count: many successful sign-ins do not lock anyone', async () => {
    const { login } = setup();
    for (let i = 0; i < 10; i++) expect((await login('asha@salon.in', PASSWORD)).ok).toBe(true);
  });

  it('the lock lifts after 15 minutes', async () => {
    const { login, clock } = setup();
    for (let i = 0; i < 5; i++) await login('asha@salon.in', 'wrong');
    expect((await login('asha@salon.in', PASSWORD)).ok).toBe(false);
    clock.ms += 15 * 60_000;
    expect((await login('asha@salon.in', PASSWORD)).ok).toBe(true);
  });

  it('one address trying many emails is slowed down too (30 attempts per 15 minutes)', async () => {
    const { login } = setup();
    for (let i = 0; i < LOGIN_LIMITS.perIp.limit; i++) await login(`guess${i}@salon.in`, 'x');
    expect(await login('asha@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'locked' });
    expect((await login('asha@salon.in', PASSWORD, '198.51.100.9')).ok).toBe(true); // a different address
  });

  it('a failed bot check stops everything: no password check, and it does not count as a bad password', async () => {
    const { login, deps } = setup();
    deps.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'rejected' });
    for (let i = 0; i < 8; i++)
      expect(await login('asha@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'captcha' });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    deps.verifyTurnstile.mockResolvedValue({ ok: true });
    expect((await login('asha@salon.in', PASSWORD)).ok).toBe(true); // not locked by the bot-check failures
  });

  it('reports an unavailable bot check separately (fails closed)', async () => {
    const { login, deps } = setup();
    for (const reason of ['unavailable', 'not-configured'] as const) {
      deps.verifyTurnstile.mockResolvedValue({ ok: false, reason });
      expect(await login('asha@salon.in', PASSWORD)).toEqual({ ok: false, reason: 'unavailable' });
    }
  });

  it('refuses malformed input without touching the database', async () => {
    const { deps } = setup();
    for (const bad of [
      null,
      {},
      { email: 'a' },
      { email: 'asha@salon.in', password: '' },
      { email: 'asha@salon.in', password: 'x' },
      'text',
    ]) {
      expect(await attemptLogin(bad, '1.2.3.4', deps)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(deps.findStaff).not.toHaveBeenCalled();
  });

  it('never logs an email, a password or an address', async () => {
    const { login, deps } = setup();
    await login('asha@salon.in', PASSWORD);
    await login('asha@salon.in', 'wrong-secret');
    for (let i = 0; i < 6; i++) await login('asha@salon.in', 'wrong-secret');
    const logged = JSON.stringify(deps.log.mock.calls);
    for (const secret of ['asha@salon.in', 'asha', PASSWORD, 'wrong-secret', '203.0.113.7']) {
      expect(logged).not.toContain(secret);
    }
  });
});
