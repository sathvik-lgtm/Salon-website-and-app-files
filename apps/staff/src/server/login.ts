import type { RateLimiter } from '@salon/security/rate-limit';
import type { TurnstileResult } from '@salon/security/turnstile';
import { z } from 'zod';

/**
 * Staff sign-in, with every defence in one place and every dependency passed in (so it is tested
 * without a database, a network or a clock).
 *
 * Order: input shape -> per-IP flood limit -> lockout check -> Turnstile -> look up the account and
 * check the password -> count a failure. Locked after 5 FAILED attempts per email + IP in 15 minutes.
 * Whatever goes wrong, the caller shows one generic message, so the response never says whether an
 * email exists.
 */
export interface LoginDeps {
  limiter: RateLimiter;
  verifyTurnstile(token: string, ip: string): Promise<TurnstileResult>;
  findStaff(email: string): Promise<{
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    active: boolean;
  } | null>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  /** SHA-256 of an identifier, so counter keys hold no email or IP address. */
  hashId(value: string): Promise<string>;
  /** Must never be given an email, a password or an address. */
  log(event: string, data?: Record<string, string | number | boolean>): void;
}

export const LOGIN_LIMITS = {
  /** Failed attempts per email + IP before locking. */
  failures: { limit: 5, windowSec: 15 * 60 },
  /** Any attempts from one IP, whatever the email: slows trying many accounts. */
  perIp: { limit: 30, windowSec: 15 * 60 },
} as const;

export type LoginResult =
  | { ok: true; staff: { id: string; email: string; name: string } }
  | { ok: false; reason: 'invalid' | 'locked' | 'captcha' | 'unavailable' };

const inputSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
  turnstileToken: z.string().min(1).max(2048),
});

/**
 * A real-format hash that nobody's password matches. Checked when the email is unknown, so an
 * unknown email takes as long as a wrong password (no timing clue about which emails exist).
 */
export const DUMMY_HASH = `pbkdf2$sha256$100000$${btoa(String.fromCharCode(...new Uint8Array(16)))}$${btoa(
  String.fromCharCode(...new Uint8Array(32)),
)}`;

export async function attemptLogin(
  input: unknown,
  ip: string,
  deps: LoginDeps,
): Promise<LoginResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const email = parsed.data.email.toLowerCase();

  const ipKey = await deps.hashId(ip);
  const flood = await deps.limiter.hit(
    'login-ip',
    ipKey,
    LOGIN_LIMITS.perIp.limit,
    LOGIN_LIMITS.perIp.windowSec,
  );
  if (!flood.allowed) {
    deps.log('login_locked', { scope: 'ip' });
    return { ok: false, reason: 'locked' };
  }

  const failKey = `${await deps.hashId(email)}.${ipKey}`;
  const lock = await deps.limiter.peek(
    'login-fail',
    failKey,
    LOGIN_LIMITS.failures.limit,
    LOGIN_LIMITS.failures.windowSec,
  );
  if (!lock.allowed) {
    deps.log('login_locked', { scope: 'account' });
    return { ok: false, reason: 'locked' };
  }

  const captcha = await deps.verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!captcha.ok) {
    deps.log('login_captcha_failed', { reason: captcha.reason });
    return { ok: false, reason: captcha.reason === 'rejected' ? 'captcha' : 'unavailable' };
  }

  const staff = await deps.findStaff(email);
  const passwordOk = await deps.verifyPassword(
    parsed.data.password,
    staff?.passwordHash ?? DUMMY_HASH,
  );
  if (!staff || !staff.active || !passwordOk) {
    await deps.limiter.hit(
      'login-fail',
      failKey,
      LOGIN_LIMITS.failures.limit,
      LOGIN_LIMITS.failures.windowSec,
    );
    deps.log('login_failed');
    return { ok: false, reason: 'invalid' };
  }

  deps.log('login_ok');
  return { ok: true, staff: { id: staff.id, email: staff.email, name: staff.name } };
}
