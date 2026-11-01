import type {
  CreateInput,
  CreateResult,
  FailureReason,
  SlotsInput,
  SlotsResult,
  StylistsResult,
} from '@salon/booking';
import { z } from 'zod';
import { hashId, type RateLimiter } from '@salon/security/rate-limit';
import { clientIp, isSameOrigin } from '@salon/security/request';
import type { TurnstileResult } from '@salon/security/turnstile';

/**
 * The booking API's request handling, with every dependency passed in so it can be tested without a
 * database, a network or a clock. The route files only wire real dependencies in (see deps.ts).
 *
 * Order of defences on `POST /api/bookings`, cheapest first:
 *   same-origin check -> per-IP rate limit -> JSON + Zod validation (honeypot, consent)
 *   -> phone normalisation -> Turnstile -> per-phone rate limit -> the booking engine.
 * The engine adds the last layers: re-validation of every rule, the per-phone cap on upcoming
 * bookings, and the database's no-double-booking constraint.
 */

export interface ApiDeps {
  engine: {
    getSlots(input: SlotsInput): Promise<SlotsResult>;
    listStylists(input: { branchId: string; serviceIds: string[] }): Promise<StylistsResult>;
    create(input: CreateInput): Promise<CreateResult>;
    normalizePhone(phone: string): string | null;
  };
  rateLimiter: RateLimiter;
  verifyTurnstile(token: string, ip: string): Promise<TurnstileResult>;
  now(): Date;
  /** Structured log line. Must never be given a name, phone number or other personal data. */
  log(event: string, data?: Record<string, string | number | boolean>): void;
}

/** Attempts allowed per window. Writes are limited much harder than reads, as the brief asks. */
export const LIMITS = {
  createPerIp: { limit: 5, windowSec: 60 },
  createPerPhone: { limit: 3, windowSec: 3600 },
  readPerIp: { limit: 60, windowSec: 60 },
} as const;

const MAX_BODY_BYTES = 8 * 1024;

const STATUS: Record<FailureReason, number> = {
  INVALID_INPUT: 400,
  INVALID_PHONE: 422,
  BRANCH_NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 422,
  STYLIST_NOT_ELIGIBLE: 422,
  OUTSIDE_BOOKING_WINDOW: 422,
  TOO_SOON: 422,
  SLOT_UNAVAILABLE: 409,
  SLOT_TAKEN: 409,
  PHONE_LIMIT_REACHED: 422,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

const fail = (code: string, status: number, headers?: Record<string, string>) =>
  json({ error: code }, status, headers);

const tooMany = (retryAfterSec: number) =>
  fail('RATE_LIMITED', 429, { 'Retry-After': String(Math.max(1, retryAfterSec)) });

// ---------- reads ----------

const id = z.string().min(1).max(64);
const readQuery = z.object({
  branchId: id,
  serviceIds: z.array(id).min(1).max(8),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stylistId: id,
});
const stylistsQuery = readQuery.pick({ branchId: true, serviceIds: true });

const serviceIdsFrom = (params: URLSearchParams) =>
  (params.get('serviceIds') ?? '').split(',').filter(Boolean);

/** `GET /api/availability?branchId&serviceIds=a,b&date=YYYY-MM-DD&stylistId=ANY|id` */
export async function handleAvailability(request: Request, deps: ApiDeps): Promise<Response> {
  const ip = await hashId(clientIp(request));
  const limit = await deps.rateLimiter.hit(
    'read',
    ip,
    LIMITS.readPerIp.limit,
    LIMITS.readPerIp.windowSec,
  );
  if (!limit.allowed) {
    deps.log('rate_limited', { scope: 'read' });
    return tooMany(limit.retryAfterSec);
  }

  const params = new URL(request.url).searchParams;
  const parsed = readQuery.safeParse({
    branchId: params.get('branchId'),
    serviceIds: serviceIdsFrom(params),
    date: params.get('date'),
    stylistId: params.get('stylistId') ?? 'ANY',
  });
  if (!parsed.success) return fail('INVALID_INPUT', 400);

  try {
    const result = await deps.engine.getSlots(parsed.data);
    if (!result.ok) return fail(result.reason, STATUS[result.reason]);
    return json({
      slots: result.slots.map((s) => ({ time: s.time, startAt: s.startAt.toISOString() })),
    });
  } catch (error) {
    deps.log('read_error', { type: error instanceof Error ? error.name : 'unknown' });
    return fail('SERVER_ERROR', 500);
  }
}

/** `GET /api/stylists?branchId&serviceIds=a,b` */
export async function handleStylists(request: Request, deps: ApiDeps): Promise<Response> {
  const ip = await hashId(clientIp(request));
  const limit = await deps.rateLimiter.hit(
    'read',
    ip,
    LIMITS.readPerIp.limit,
    LIMITS.readPerIp.windowSec,
  );
  if (!limit.allowed) {
    deps.log('rate_limited', { scope: 'read' });
    return tooMany(limit.retryAfterSec);
  }

  const params = new URL(request.url).searchParams;
  const parsed = stylistsQuery.safeParse({
    branchId: params.get('branchId'),
    serviceIds: serviceIdsFrom(params),
  });
  if (!parsed.success) return fail('INVALID_INPUT', 400);

  try {
    const result = await deps.engine.listStylists(parsed.data);
    if (!result.ok) return fail(result.reason, STATUS[result.reason]);
    return json({ stylists: result.stylists });
  } catch (error) {
    deps.log('read_error', { type: error instanceof Error ? error.name : 'unknown' });
    return fail('SERVER_ERROR', 500);
  }
}

// ---------- create ----------

const createBody = z
  .object({
    branchId: id,
    serviceIds: z.array(id).min(1).max(8),
    startAt: z.iso.datetime({ offset: true }),
    stylistId: id,
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(5).max(32),
    /** The consent line on the form: must be ticked. */
    consent: z.literal(true),
    /** Honeypot: a field real visitors never see. Anything in it means a bot. */
    company_website: z.string().max(200).optional(),
    turnstileToken: z.string().min(1).max(2048),
  })
  // Unknown fields (for example a price or end time someone tries to smuggle in) are refused loudly.
  .strict();

/** `POST /api/bookings` with a JSON body. */
export async function handleCreateBooking(request: Request, deps: ApiDeps): Promise<Response> {
  // 1. Only pages on this site may submit.
  if (!isSameOrigin(request)) {
    deps.log('forbidden_origin');
    return fail('FORBIDDEN', 403);
  }

  // 2. Per-IP rate limit.
  const ip = clientIp(request);
  const ipLimit = await deps.rateLimiter.hit(
    'create-ip',
    await hashId(ip),
    LIMITS.createPerIp.limit,
    LIMITS.createPerIp.windowSec,
  );
  if (!ipLimit.allowed) {
    deps.log('rate_limited', { scope: 'ip' });
    return tooMany(ipLimit.retryAfterSec);
  }

  // 3. JSON only, small, and exactly the expected shape.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return fail('INVALID_INPUT', 415);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail('INVALID_INPUT', 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('INVALID_INPUT', 400);
  }
  const parsed = createBody.safeParse(raw);
  if (!parsed.success) return fail('INVALID_INPUT', 400);
  const body = parsed.data;

  // 4. Honeypot. Rejected like any bad input, so a person whose browser auto-filled it can retry.
  if (body.company_website) {
    deps.log('honeypot');
    return fail('INVALID_INPUT', 400);
  }

  // 5. A phone number we can normalise (cheap, so before the network call below).
  const phone = deps.engine.normalizePhone(body.phone);
  if (!phone) return fail('INVALID_PHONE', 422);

  // 6. Turnstile, verified here on the server.
  const captcha = await deps.verifyTurnstile(body.turnstileToken, ip);
  if (!captcha.ok) {
    deps.log('captcha_failed', { reason: captcha.reason });
    // Misconfiguration or an outage is our fault, not the visitor's.
    return captcha.reason === 'rejected' ? fail('CAPTCHA_FAILED', 400) : fail('SERVER_ERROR', 503);
  }

  // 7. Per-phone rate limit (after Turnstile, so a bot cannot burn a real person's allowance).
  const phoneLimit = await deps.rateLimiter.hit(
    'create-phone',
    await hashId(phone),
    LIMITS.createPerPhone.limit,
    LIMITS.createPerPhone.windowSec,
  );
  if (!phoneLimit.allowed) {
    deps.log('rate_limited', { scope: 'phone' });
    return tooMany(phoneLimit.retryAfterSec);
  }

  // 8. The engine re-checks everything and is the only thing that writes.
  try {
    const result = await deps.engine.create({
      branchId: body.branchId,
      serviceIds: body.serviceIds,
      startAt: new Date(body.startAt),
      stylistId: body.stylistId,
      customer: { name: body.name, phone: body.phone },
      source: 'ONLINE',
      consentAt: deps.now(),
    });
    if (!result.ok) {
      deps.log('booking_refused', { reason: result.reason });
      return fail(result.reason, STATUS[result.reason]);
    }
    const a = result.appointment;
    deps.log('booking_created');
    return json(
      {
        appointment: {
          id: a.id,
          branchId: a.branchId,
          staffId: a.staffId,
          staffName: a.staffName,
          startAt: a.startAt.toISOString(),
          endAt: a.endAt.toISOString(),
          totalPricePaise: a.totalPricePaise,
          totalDurationMin: a.totalDurationMin,
          items: a.items,
        },
      },
      201,
    );
  } catch (error) {
    // Never show a stack trace or database message to a customer, and never log their details.
    deps.log('booking_error', { type: error instanceof Error ? error.name : 'unknown' });
    return fail('SERVER_ERROR', 500);
  }
}
