import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Settings and Cloudflare bindings. On Workers, secrets and variables arrive through the request's
 * Cloudflare context (and OpenNext also mirrors them into `process.env`); locally they come from
 * `.env.local`. Both are checked, so the same code runs everywhere.
 */
function cloudflareEnv(): Record<string, unknown> {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return {}; // not running on Workers (local `next dev` / `next start`, tests)
  }
}

export function getEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const fromCloudflare = cloudflareEnv()[name];
  return typeof fromCloudflare === 'string' && fromCloudflare ? fromCloudflare : undefined;
}

/** The slice of a Workers KV namespace we use. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** A KV namespace binding by name, or undefined when there is none (local development). */
export function getKv(name: string): KvLike | undefined {
  const binding = cloudflareEnv()[name] as Partial<KvLike> | undefined;
  return binding && typeof binding.get === 'function' && typeof binding.put === 'function'
    ? (binding as KvLike)
    : undefined;
}
