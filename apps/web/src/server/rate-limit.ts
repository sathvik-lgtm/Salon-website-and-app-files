/**
 * Fixed-window rate limiting on a key-value store (Cloudflare KV in production).
 *
 * KV is eventually consistent, has no atomic increment, and allows one write per second per key, so
 * this is a coarse abuse brake, not a precise meter: a determined attacker spread across Cloudflare
 * locations can exceed a limit by some margin. It is backed up by Turnstile and by the booking
 * engine's own per-phone cap of upcoming bookings. If the limits ever need to be exact, move the
 * counters to a Durable Object (see docs/FUTURE.md).
 */
export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` is how long the counter may live (KV needs at least 60). */
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends (for the `Retry-After` header). 0 when allowed. */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Counts one attempt by `id` in `scope` and says whether it is within `limit` per `windowSec`. */
  hit(scope: string, id: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

export function createRateLimiter(
  store: RateLimitStore,
  options: { now?: () => number; onError?: (error: unknown) => void } = {},
): RateLimiter {
  const now = options.now ?? Date.now;
  return {
    async hit(scope, id, limit, windowSec) {
      const nowSec = Math.floor(now() / 1000);
      const bucket = Math.floor(nowSec / windowSec);
      const key = `rl:${scope}:${id}:${bucket}`;
      try {
        const count = Number(await store.get(key)) || 0;
        if (count >= limit) {
          return { allowed: false, retryAfterSec: (bucket + 1) * windowSec - nowSec };
        }
        await store.put(key, String(count + 1), Math.max(60, windowSec * 2));
        return { allowed: true, retryAfterSec: 0 };
      } catch (error) {
        // A broken counter must never stop a real customer from booking: allow, and report it.
        options.onError?.(error);
        return { allowed: true, retryAfterSec: 0 };
      }
    },
  };
}

/** In-process store: used when no KV binding exists (local dev, tests). Per server instance only. */
export function createMemoryStore(now: () => number = Date.now): RateLimitStore {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry.value;
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      if (entries.size > 5000) {
        for (const [k, v] of entries) if (v.expiresAt <= now()) entries.delete(k);
      }
    },
  };
}

/** Adapts a Workers KV namespace to the store interface. */
export function createKvStore(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}): RateLimitStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds }),
  };
}

/** SHA-256 (first 32 hex chars) so counter keys never contain an IP address or phone number. */
export async function hashId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
