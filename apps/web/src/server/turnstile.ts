/**
 * Server-side Cloudflare Turnstile check. The widget alone protects nothing (tokens can be forged):
 * every booking must be verified here. A token is single-use and valid for 5 minutes.
 */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult =
  { ok: true } | { ok: false; reason: 'not-configured' | 'rejected' | 'unavailable' };

export async function verifyTurnstile({
  token,
  ip,
  secret,
  fetchImpl = fetch,
}: {
  token: string;
  /** The visitor's address, or 'unknown'. */
  ip: string;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileResult> {
  // No secret means misconfiguration. Fail closed: never let bookings through unchecked.
  if (!secret) return { ok: false, reason: 'not-configured' };
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        ...(ip !== 'unknown' ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
