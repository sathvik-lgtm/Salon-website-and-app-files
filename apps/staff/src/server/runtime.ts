import 'server-only';
import { createDb, type Db } from '@salon/db';
import { getEnv, getKv } from '@salon/security/env';
import { createKvStore, createMemoryStore, createRateLimiter } from '@salon/security/rate-limit';

/** Per-request wiring: a database client, the rate limiter and a PII-free log line. */

// Used when there is no KV binding (local development). Lives as long as the server process.
const memoryStore = createMemoryStore();

export const log = (event: string, data?: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ app: 'staff', event, ...data }));

export function getLimiter() {
  const kv = getKv('RATE_LIMIT');
  return createRateLimiter(kv ? createKvStore(kv) : memoryStore, {
    onError: (error) =>
      log('rate_limit_store_error', { type: error instanceof Error ? error.name : 'unknown' }),
  });
}

/**
 * Runs `run` with a database client and always closes it afterwards. A client is created per
 * request: on Workers a connection must not outlive the request that opened it.
 */
export async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const url = getEnv('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is not set');
  // Workers use the Neon driver; local development and CI use plain `pg`.
  const db = createDb(url, getEnv('DB_DRIVER') === 'pg' ? 'pg' : 'neon');
  try {
    return await run(db);
  } finally {
    await db.$disconnect();
  }
}
