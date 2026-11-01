import { describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  handleAvailability,
  handleCreateBooking,
  handleHealth,
  handleStylists,
  type ApiDeps,
} from './booking-api';
import { createMemoryStore, createRateLimiter } from '@salon/security/rate-limit';

const HOST = 'salon.test';
const NOW = new Date('2026-11-09T04:00:00Z');

/** Real rate limiter on a fake clock; everything else is a spy. */
function makeDeps(overrides: Partial<ApiDeps['engine']> = {}, clock = { ms: NOW.getTime() }) {
  const store = createMemoryStore(() => clock.ms);
  const engine = {
    getSlots: vi.fn(async () => ({
      ok: true as const,
      slots: [{ time: '10:00', startAt: new Date('2026-11-10T04:30:00Z') }],
    })),
    listStylists: vi.fn(async () => ({
      ok: true as const,
      stylists: [{ id: 's1', name: 'Asha' }],
    })),
    create: vi.fn(async () => ({
      ok: true as const,
      appointment: {
        id: 'appt1',
        customerId: 'c1',
        branchId: 'b1',
        staffId: 's1',
        staffName: 'Asha',
        startAt: new Date('2026-11-10T04:30:00Z'),
        endAt: new Date('2026-11-10T05:15:00Z'),
        totalPricePaise: 60000,
        totalDurationMin: 45,
        stylistPreference: 'SPECIFIC' as const,
        items: [{ serviceId: 'svc1', serviceName: 'Haircut', pricePaise: 60000, durationMin: 45 }],
      },
    })),
    // Like the real one, different numbers stay different.
    normalizePhone: vi.fn((p: string) =>
      /^\+?\d[\d\s-]{8,}$/.test(p) ? '+91' + p.replace(/\D/g, '').slice(-10) : null,
    ),
    ...overrides,
  };
  const deps = {
    engine,
    rateLimiter: createRateLimiter(store, { now: () => clock.ms }),
    pingDatabase: vi.fn(async () => {}),
    verifyTurnstile: vi.fn(async () => ({ ok: true as const })) as ApiDeps['verifyTurnstile'] &
      ReturnType<typeof vi.fn>,
    now: () => NOW,
    log: vi.fn(),
  } satisfies ApiDeps;
  return { deps, engine, clock };
}

const validBody = {
  branchId: 'b1',
  serviceIds: ['svc1'],
  startAt: '2026-11-10T04:30:00.000Z',
  stylistId: 's1',
  name: 'Test Customer',
  phone: '98765 43210',
  consent: true,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
};

function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(`https://${HOST}/api/bookings`, {
    method: 'POST',
    headers: {
      host: HOST,
      origin: `https://${HOST}`,
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://${HOST}${path}`, {
    headers: { host: HOST, 'cf-connecting-ip': '203.0.113.7', ...headers },
  });

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe('POST /api/bookings', () => {
  it('creates a booking and returns what the confirmation page needs', async () => {
    const { deps, engine } = makeDeps();
    const res = await handleCreateBooking(post(validBody), deps);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { appointment } = (await res.json()) as { appointment: Record<string, unknown> };
    expect(appointment).toMatchObject({
      id: 'appt1',
      staffName: 'Asha',
      startAt: '2026-11-10T04:30:00.000Z',
      totalPricePaise: 60000,
    });
    // Always an online booking; consent time is the server's clock, not the browser's.
    expect(engine.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ONLINE', consentAt: NOW, stylistId: 's1' }),
    );
    // The phone we hand the engine is what the customer typed; the engine normalises it itself.
    expect((engine.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].customer).toEqual({
      name: 'Test Customer',
      phone: '98765 43210',
    });
  });

  describe('same-origin check', () => {
    it('refuses another site, a missing origin, and a null origin, before doing anything else', async () => {
      for (const headers of [
        { origin: 'https://evil.example' },
        { origin: 'null' },
        { origin: '' },
      ]) {
        const { deps, engine } = makeDeps();
        const req = post(validBody, headers);
        if (!headers.origin) req.headers.delete('origin');
        const res = await handleCreateBooking(req, deps);
        expect(res.status).toBe(403);
        expect(await errorOf(res)).toBe('FORBIDDEN');
        expect(deps.verifyTurnstile).not.toHaveBeenCalled();
        expect(engine.create).not.toHaveBeenCalled();
      }
    });

    it('accepts the Referer when there is no Origin, and refuses a foreign Referer', async () => {
      const ok = makeDeps();
      const a = post(validBody, { referer: `https://${HOST}/book` });
      a.headers.delete('origin');
      expect((await handleCreateBooking(a, ok.deps)).status).toBe(201);

      const bad = makeDeps();
      const b = post(validBody, { referer: 'https://evil.example/book' });
      b.headers.delete('origin');
      expect((await handleCreateBooking(b, bad.deps)).status).toBe(403);
    });
  });

  describe('input validation', () => {
    it('requires JSON, a small body and valid JSON', async () => {
      const { deps, engine } = makeDeps();
      expect(
        (await handleCreateBooking(post(validBody, { 'content-type': 'text/plain' }), deps)).status,
      ).toBe(415);
      expect((await handleCreateBooking(post(null, {}, '{not json'), deps)).status).toBe(400);
      const huge = JSON.stringify({ ...validBody, name: 'x'.repeat(9000) });
      expect((await handleCreateBooking(post(null, {}, huge), deps)).status).toBe(413);
      expect(engine.create).not.toHaveBeenCalled();
    });

    it('refuses missing consent, unknown fields (a smuggled price), and bad shapes', async () => {
      const { deps, engine } = makeDeps();
      const bad = [
        { ...validBody, consent: false },
        { ...validBody, consent: undefined },
        { ...validBody, totalPricePaise: 1 },
        { ...validBody, endAt: '2026-11-10T04:35:00.000Z' },
        { ...validBody, serviceIds: [] },
        { ...validBody, startAt: 'tomorrow' },
        { ...validBody, name: '   ' },
        { ...validBody, turnstileToken: '' },
      ];
      for (const [i, body] of bad.entries()) {
        // A different visitor each time, so the per-IP limit stays out of the way.
        const res = await handleCreateBooking(
          post(body, { 'cf-connecting-ip': `192.0.2.${i}` }),
          deps,
        );
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(await errorOf(res)).toBe('INVALID_INPUT');
      }
      expect(engine.create).not.toHaveBeenCalled();
      expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    });

    it('rejects a filled honeypot without calling Turnstile or the engine', async () => {
      const { deps, engine } = makeDeps();
      const res = await handleCreateBooking(
        post({ ...validBody, company_website: 'http://spam.example' }),
        deps,
      );
      expect(res.status).toBe(400);
      expect(deps.verifyTurnstile).not.toHaveBeenCalled();
      expect(engine.create).not.toHaveBeenCalled();
      expect(deps.log).toHaveBeenCalledWith('honeypot');
    });

    it('accepts an empty honeypot', async () => {
      const { deps } = makeDeps();
      expect(
        (await handleCreateBooking(post({ ...validBody, company_website: '' }), deps)).status,
      ).toBe(201);
    });

    it('refuses a phone number that cannot be normalised, before the Turnstile call', async () => {
      const { deps, engine } = makeDeps();
      const res = await handleCreateBooking(post({ ...validBody, phone: 'abcde' }), deps);
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toBe('INVALID_PHONE');
      expect(deps.verifyTurnstile).not.toHaveBeenCalled();
      expect(engine.create).not.toHaveBeenCalled();
    });
  });

  describe('Turnstile', () => {
    it('refuses a rejected token with CAPTCHA_FAILED and never reaches the engine', async () => {
      const { deps, engine } = makeDeps();
      deps.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'rejected' });
      const res = await handleCreateBooking(post(validBody), deps);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe('CAPTCHA_FAILED');
      expect(engine.create).not.toHaveBeenCalled();
    });

    it('fails closed (503) when Turnstile is unavailable or not configured', async () => {
      for (const reason of ['unavailable', 'not-configured'] as const) {
        const { deps, engine } = makeDeps();
        deps.verifyTurnstile.mockResolvedValue({ ok: false, reason });
        const res = await handleCreateBooking(post(validBody), deps);
        expect(res.status).toBe(503);
        expect(await errorOf(res)).toBe('SERVER_ERROR');
        expect(engine.create).not.toHaveBeenCalled();
      }
    });

    it('passes the token and the visitor address to the verifier', async () => {
      const { deps } = makeDeps();
      await handleCreateBooking(post(validBody), deps);
      expect(deps.verifyTurnstile).toHaveBeenCalledWith('XXXX.DUMMY.TOKEN.XXXX', '203.0.113.7');
    });
  });

  describe('rate limits', () => {
    it('allows 5 attempts per IP per minute and answers the 6th with 429 + Retry-After', async () => {
      const { deps, clock } = makeDeps();
      // A different phone each time, so only the per-IP limit can trigger.
      const attempt = (n: number) =>
        handleCreateBooking(post({ ...validBody, phone: `98765 4321${n}` }), deps);
      for (let i = 0; i < LIMITS.createPerIp.limit; i++)
        expect((await attempt(i)).status).toBe(201);
      const res = await attempt(5);
      expect(res.status).toBe(429);
      expect(await errorOf(res)).toBe('RATE_LIMITED');
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(60);

      // A fresh window opens a minute later.
      clock.ms += 61_000;
      expect((await attempt(6)).status).toBe(201);
    });

    it('a different IP has its own allowance', async () => {
      const { deps } = makeDeps();
      const attempt = (n: number, ip: string) =>
        handleCreateBooking(
          post({ ...validBody, phone: `98765 4321${n}` }, { 'cf-connecting-ip': ip }),
          deps,
        );
      for (let i = 0; i < 5; i++) await attempt(i, '203.0.113.7');
      expect((await attempt(5, '203.0.113.7')).status).toBe(429);
      expect((await attempt(6, '198.51.100.9')).status).toBe(201);
    });

    it('allows 3 attempts per phone per hour across different IPs, then 429', async () => {
      const { deps, engine } = makeDeps();
      for (let i = 0; i < LIMITS.createPerPhone.limit; i++) {
        const res = await handleCreateBooking(
          post(validBody, { 'cf-connecting-ip': `198.51.100.${i}` }),
          deps,
        );
        expect(res.status).toBe(201);
      }
      const res = await handleCreateBooking(
        post(validBody, { 'cf-connecting-ip': '198.51.100.99' }),
        deps,
      );
      expect(res.status).toBe(429);
      expect(engine.create).toHaveBeenCalledTimes(3);
    });

    it("a bot failing Turnstile cannot use up a real person's phone allowance", async () => {
      const { deps } = makeDeps();
      deps.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'rejected' });
      for (let i = 0; i < 5; i++)
        await handleCreateBooking(post(validBody, { 'cf-connecting-ip': `198.51.100.${i}` }), deps);
      deps.verifyTurnstile.mockResolvedValue({ ok: true });
      expect(
        (await handleCreateBooking(post(validBody, { 'cf-connecting-ip': '198.51.100.50' }), deps))
          .status,
      ).toBe(201);
    });

    it('fails open when the counter store is broken, and reports it', async () => {
      const onError = vi.fn();
      const broken = createRateLimiter(
        {
          get: async () => {
            throw new Error('KV down');
          },
          put: async () => {},
        },
        { onError },
      );
      const { deps } = makeDeps();
      const res = await handleCreateBooking(post(validBody), { ...deps, rateLimiter: broken });
      expect(res.status).toBe(201);
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('engine outcomes', () => {
    it.each([
      ['SLOT_TAKEN', 409],
      ['SLOT_UNAVAILABLE', 409],
      ['TOO_SOON', 422],
      ['OUTSIDE_BOOKING_WINDOW', 422],
      ['PHONE_LIMIT_REACHED', 422],
      ['STYLIST_NOT_ELIGIBLE', 422],
      ['SERVICE_UNAVAILABLE', 422],
      ['BRANCH_NOT_FOUND', 404],
    ] as const)('maps %s to HTTP %i with the reason code', async (reason, status) => {
      const { deps } = makeDeps({ create: vi.fn(async () => ({ ok: false as const, reason })) });
      const res = await handleCreateBooking(post(validBody), deps);
      expect(res.status).toBe(status);
      expect(await errorOf(res)).toBe(reason);
    });

    it('turns an unexpected failure into a plain 500 without leaking detail or personal data', async () => {
      const { deps } = makeDeps({
        create: vi.fn(async () => {
          throw new Error('connection to db.internal:5432 refused for Test Customer');
        }),
      });
      const res = await handleCreateBooking(post(validBody), deps);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toBe('{"error":"SERVER_ERROR"}');
      const logged = JSON.stringify(deps.log.mock.calls);
      expect(logged).not.toContain('Test Customer');
      expect(logged).not.toContain('98765');
      expect(logged).not.toContain('db.internal');
    });

    it('never logs names, phone numbers or addresses on any path', async () => {
      const { deps } = makeDeps();
      await handleCreateBooking(post(validBody), deps);
      await handleCreateBooking(post({ ...validBody, company_website: 'x' }), deps);
      await handleCreateBooking(post(validBody, { origin: 'https://evil.example' }), deps);
      const logged = JSON.stringify(deps.log.mock.calls);
      for (const secret of ['Test Customer', '98765', '9876543210', '203.0.113.7']) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});

describe('GET /api/availability and /api/stylists', () => {
  const q = '?branchId=b1&serviceIds=svc1,svc2&date=2026-11-10&stylistId=ANY';

  it('returns slots as time + UTC instant, uncached', async () => {
    const { deps, engine } = makeDeps();
    const res = await handleAvailability(get(`/api/availability${q}`), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      slots: [{ time: '10:00', startAt: '2026-11-10T04:30:00.000Z' }],
    });
    expect(engine.getSlots).toHaveBeenCalledWith({
      branchId: 'b1',
      serviceIds: ['svc1', 'svc2'],
      date: '2026-11-10',
      stylistId: 'ANY',
    });
  });

  it('defaults the stylist to ANY and refuses bad queries', async () => {
    const { deps, engine } = makeDeps();
    await handleAvailability(
      get('/api/availability?branchId=b1&serviceIds=svc1&date=2026-11-10'),
      deps,
    );
    expect(engine.getSlots).toHaveBeenCalledWith(expect.objectContaining({ stylistId: 'ANY' }));
    for (const bad of [
      '',
      '?branchId=b1',
      '?branchId=b1&serviceIds=a&date=10-11-2026',
      '?branchId=b1&serviceIds=&date=2026-11-10',
    ]) {
      const res = await handleAvailability(get(`/api/availability${bad}`), deps);
      expect(res.status, bad).toBe(400);
    }
  });

  it('maps engine refusals and survives a database failure', async () => {
    const refusal = makeDeps({
      getSlots: vi.fn(async () => ({
        ok: false as const,
        reason: 'OUTSIDE_BOOKING_WINDOW' as const,
      })),
    });
    const res = await handleAvailability(get(`/api/availability${q}`), refusal.deps);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe('OUTSIDE_BOOKING_WINDOW');

    const broken = makeDeps({
      getSlots: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const failed = await handleAvailability(get(`/api/availability${q}`), broken.deps);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('{"error":"SERVER_ERROR"}');
  });

  it('lists stylists, validates, and survives failure', async () => {
    const { deps } = makeDeps();
    const ok = await handleStylists(get('/api/stylists?branchId=b1&serviceIds=svc1'), deps);
    expect(await ok.json()).toEqual({ stylists: [{ id: 's1', name: 'Asha' }] });
    expect((await handleStylists(get('/api/stylists?branchId=b1'), deps)).status).toBe(400);
    const broken = makeDeps({
      listStylists: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    expect(
      (await handleStylists(get('/api/stylists?branchId=b1&serviceIds=svc1'), broken.deps)).status,
    ).toBe(500);
  });

  it('limits reads to 60 per IP per minute, much looser than booking', async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < LIMITS.readPerIp.limit; i++) {
      expect((await handleAvailability(get(`/api/availability${q}`), deps)).status).toBe(200);
    }
    const res = await handleAvailability(get(`/api/availability${q}`), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(LIMITS.readPerIp.limit).toBeGreaterThan(LIMITS.createPerIp.limit * 5);
  });
});

describe('GET /api/health', () => {
  const get = (query = '', ip = '10.0.0.1') =>
    new Request(`https://${HOST}/api/health${query}`, { headers: { host: HOST, 'x-forwarded-for': ip } });

  it('says the site is up without touching the database', async () => {
    const { deps } = makeDeps();
    const res = await handleHealth(get(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deps.pingDatabase).not.toHaveBeenCalled();
  });

  it('checks the database only when asked (?db=1)', async () => {
    const { deps } = makeDeps();
    const res = await handleHealth(get('?db=1'), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
    expect(deps.pingDatabase).toHaveBeenCalledTimes(1);
  });

  it('answers 503 with no details when the database is down', async () => {
    const { deps } = makeDeps();
    deps.pingDatabase.mockRejectedValueOnce(new Error('connect ECONNREFUSED postgres://user:secret@host/db'));
    const res = await handleHealth(get('?db=1'), deps);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain('secret');
  });

  it('limits how often one address can run the database check', async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < LIMITS.readPerIp.limit; i++) await handleHealth(get('?db=1'), deps);
    expect((await handleHealth(get('?db=1'), deps)).status).toBe(429);
  });
});
