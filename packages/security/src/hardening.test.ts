import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEnvelope, parseDsn, reportError, resetErrorBudget, scrubMessage, scrubRoute } from './error-report';
import { contentSecurityPolicy, securityHeaders } from './headers';

describe('security headers', () => {
  it('carries the full set on every response', () => {
    const keys = securityHeaders().map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'Strict-Transport-Security',
      ]),
    );
  });

  it('never allows framing, plugins, or other origins by default', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain('challenges.cloudflare.com');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('opens exactly Turnstile for the pages that use it', () => {
    const csp = contentSecurityPolicy({ turnstile: true });
    expect(csp).toContain('script-src');
    expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('allows Cloudflare analytics only when asked, and nothing else third-party', () => {
    expect(contentSecurityPolicy({ turnstile: true })).not.toContain('cloudflareinsights');
    const csp = contentSecurityPolicy({ turnstile: true, analytics: true });
    const origins = csp.match(/https:\/\/[a-z.]+/g) ?? [];
    expect(new Set(origins)).toEqual(
      new Set(['https://static.cloudflareinsights.com', 'https://cloudflareinsights.com', 'https://challenges.cloudflare.com']),
    );
  });

  it('allows eval only for the development server', () => {
    expect(contentSecurityPolicy({ development: true })).toContain("'unsafe-eval'");
  });
});

describe('error reports', () => {
  const dsn = 'https://publickey@o123.ingest.sentry.io/456';
  beforeEach(() => resetErrorBudget());

  it('blanks emails, phone-like numbers and everything after the first line', () => {
    expect(scrubMessage('Could not reach asha@example.com or +91 98765 43210')).toBe(
      'Could not reach [email] or [number]',
    );
    expect(scrubMessage('Invalid `prisma.customer.upsert()` invocation:\n{ phone: "+919876543210", name: "Asha" }')).toBe(
      'Invalid `prisma.customer.upsert()` invocation:',
    );
    expect(scrubMessage('x'.repeat(500)).length).toBe(120);
  });

  it('keeps the route pattern but drops a query string', () => {
    expect(scrubRoute('/api/availability?phone=9876543210')).toBe('/api/availability');
    expect(scrubRoute(undefined)).toBeUndefined();
  });

  it('turns a DSN into the documented envelope endpoint, and rejects bad ones', () => {
    expect(parseDsn(dsn)).toEqual({ endpoint: 'https://o123.ingest.sentry.io/api/456/envelope/', dsn });
    expect(parseDsn(undefined)).toBeUndefined();
    expect(parseDsn('not a url')).toBeUndefined();
    expect(parseDsn('http://key@host/1')).toBeUndefined(); // https only
    expect(parseDsn('https://host/1')).toBeUndefined(); // no key
  });

  it('builds an envelope with no personal details', () => {
    const error = new Error('Booking failed for asha@example.com phone 9876543210\n  detail line');
    error.name = 'BookingError';
    const envelope = buildEnvelope(error, { app: 'web', route: '/api/bookings?x=1', method: 'POST' }, dsn);
    const [header, itemHeader, payload] = envelope.trim().split('\n') as [string, string, string];
    expect(JSON.parse(header)).toMatchObject({ dsn });
    expect(JSON.parse(itemHeader)).toMatchObject({ type: 'event', length: new TextEncoder().encode(payload).length });
    const event = JSON.parse(payload);
    expect(event.exception.values[0].type).toBe('BookingError');
    expect(event.exception.values[0].value).toBe('Booking failed for [email] phone [number]');
    expect(event.transaction).toBe('/api/bookings');
    expect(event.tags).toMatchObject({ app: 'web', method: 'POST' });
    expect(envelope).not.toContain('asha');
    expect(envelope).not.toContain('9876543210');
  });

  it('records a database error code as a tag', () => {
    const error = Object.assign(new Error('boom'), { code: 'P2002' });
    const event = JSON.parse(buildEnvelope(error, { app: 'staff' }, dsn).trim().split('\n')[2] as string);
    expect(event.tags.code).toBe('P2002');
  });

  it('does nothing without a DSN, and never throws when Sentry is unreachable', async () => {
    const fetchImpl = vi.fn();
    expect(await reportError(new Error('x'), { app: 'web' }, { dsn: undefined, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    const down = vi.fn().mockRejectedValue(new Error('network'));
    expect(await reportError(new Error('x'), { app: 'web' }, { dsn, fetchImpl: down })).toBe(false);
  });

  it('posts to the endpoint and stops after the per-minute budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const now = new Date('2026-11-02T10:00:00Z');
    for (let i = 0; i < 25; i++) await reportError(new Error('x'), { app: 'web' }, { dsn, fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://o123.ingest.sentry.io/api/456/envelope/');
    const later = new Date(now.getTime() + 61_000);
    expect(await reportError(new Error('x'), { app: 'web' }, { dsn, fetchImpl, now: later })).toBe(true);
  });
});
