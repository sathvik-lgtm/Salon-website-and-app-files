import { describe, expect, it, vi } from 'vitest';
import { createKvStore, createMemoryStore, createRateLimiter, hashId } from './rate-limit';
import { clientIp, isSameOrigin } from './request';
import { SITEVERIFY_URL, verifyTurnstile } from './turnstile';

describe('rate limiter', () => {
  it('counts per scope and id within a window, and resets in the next', async () => {
    const clock = { ms: 1_000_000_000 };
    const limiter = createRateLimiter(
      createMemoryStore(() => clock.ms),
      { now: () => clock.ms },
    );
    expect((await limiter.hit('a', 'x', 2, 60)).allowed).toBe(true);
    expect((await limiter.hit('a', 'x', 2, 60)).allowed).toBe(true);
    const denied = await limiter.hit('a', 'x', 2, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    expect((await limiter.hit('a', 'y', 2, 60)).allowed).toBe(true); // other id
    expect((await limiter.hit('b', 'x', 2, 60)).allowed).toBe(true); // other scope
    clock.ms += 60_000;
    expect((await limiter.hit('a', 'x', 2, 60)).allowed).toBe(true); // next window
  });

  it('writes counters with a TTL of at least 60 s to a KV namespace, keyed without personal data', async () => {
    const put = vi.fn(async () => {});
    const kv = createKvStore({ get: async () => null, put });
    const limiter = createRateLimiter(kv, { now: () => 1_000_000_000 });
    await limiter.hit('create-phone', await hashId('+919876543210'), 3, 3600);
    await limiter.hit('create-ip', await hashId('203.0.113.7'), 5, 10);
    const calls = put.mock.calls as unknown as [string, string, { expirationTtl: number }][];
    expect(calls[0]![2].expirationTtl).toBe(7200);
    expect(calls[1]![2].expirationTtl).toBe(60); // 10 s window still gets KV's 60 s minimum
    for (const [key] of calls) {
      expect(key).not.toContain('9876543210');
      expect(key).not.toContain('203.0.113.7');
    }
  });

  it('hashes ids stably to 32 hex characters', async () => {
    expect(await hashId('a')).toBe(await hashId('a'));
    expect(await hashId('a')).not.toBe(await hashId('b'));
    expect(await hashId('a')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('Turnstile verification', () => {
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('posts the secret, token and visitor address to Cloudflare and accepts success', async () => {
    const fetchImpl = ok({ success: true });
    expect(
      await verifyTurnstile({ token: 't', ip: '203.0.113.7', secret: 's', fetchImpl }),
    ).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(JSON.parse(init.body as string)).toEqual({
      secret: 's',
      response: 't',
      remoteip: '203.0.113.7',
    });
  });

  it('omits the address when it is unknown', async () => {
    const fetchImpl = ok({ success: true });
    await verifyTurnstile({ token: 't', ip: 'unknown', secret: 's', fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('remoteip');
  });

  it('distinguishes rejected, unavailable and not-configured, and fails closed on each', async () => {
    expect(
      await verifyTurnstile({
        token: 't',
        ip: 'x',
        secret: 's',
        fetchImpl: ok({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
      }),
    ).toEqual({ ok: false, reason: 'rejected' });
    expect(
      await verifyTurnstile({ token: 't', ip: 'x', secret: 's', fetchImpl: ok({}, 500) }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(
      await verifyTurnstile({
        token: 't',
        ip: 'x',
        secret: 's',
        fetchImpl: vi.fn(async () => {
          throw new Error('network');
        }),
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(
      await verifyTurnstile({
        token: 't',
        ip: 'x',
        secret: undefined,
        fetchImpl: ok({ success: true }),
      }),
    ).toEqual({ ok: false, reason: 'not-configured' });
  });
});

describe('request helpers', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://salon.test/api/bookings', { method: 'POST', headers });

  it('same-origin compares the host of Origin (or Referer) with the request host', () => {
    expect(isSameOrigin(req({ host: 'salon.test', origin: 'https://salon.test' }))).toBe(true);
    expect(
      isSameOrigin(req({ host: 'salon.test', origin: 'https://salon.test.evil.example' })),
    ).toBe(false);
    expect(isSameOrigin(req({ host: 'salon.test', origin: 'https://other.test' }))).toBe(false);
    expect(isSameOrigin(req({ host: 'salon.test', referer: 'https://salon.test/book' }))).toBe(
      true,
    );
    expect(isSameOrigin(req({ host: 'salon.test' }))).toBe(false);
    expect(isSameOrigin(req({ host: 'salon.test', origin: 'not a url' }))).toBe(false);
  });

  it('takes the visitor address from Cloudflare first, then X-Forwarded-For', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe(
      '1.1.1.1',
    );
    expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2');
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('rate limiter: peek (lockouts that count only failures)', () => {
  const setup = () => {
    const clock = { ms: 1_000_000_000 };
    const limiter = createRateLimiter(
      createMemoryStore(() => clock.ms),
      { now: () => clock.ms },
    );
    return { clock, limiter };
  };

  it('peeking never counts, so it can be done as often as needed', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 20; i++)
      expect((await limiter.peek('login', 'a', 3, 900)).allowed).toBe(true);
    // ...and it did not use up any of the 3 allowed hits.
    for (let i = 0; i < 3; i++)
      expect((await limiter.hit('login', 'a', 3, 900)).allowed).toBe(true);
    expect((await limiter.hit('login', 'a', 3, 900)).allowed).toBe(false);
  });

  it('locks after the limit is reached by hits, and reports how long is left', async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 5; i++) {
      expect((await limiter.peek('login', 'a', 5, 900)).allowed).toBe(true); // check first...
      await limiter.hit('login', 'a', 5, 900); // ...count the failure after
    }
    const locked = await limiter.peek('login', 'a', 5, 900);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(locked.retryAfterSec).toBeLessThanOrEqual(900);
    // Someone else is not locked out by it.
    expect((await limiter.peek('login', 'b', 5, 900)).allowed).toBe(true);
    // The lock lifts when the window ends.
    clock.ms += 900_000;
    expect((await limiter.peek('login', 'a', 5, 900)).allowed).toBe(true);
  });

  it('allows when the store is broken, and reports it', async () => {
    const onError = vi.fn();
    const limiter = createRateLimiter(
      {
        get: async () => {
          throw new Error('KV down');
        },
        put: async () => {},
      },
      { onError },
    );
    expect((await limiter.peek('login', 'a', 5, 900)).allowed).toBe(true);
    expect(onError).toHaveBeenCalled();
  });
});
