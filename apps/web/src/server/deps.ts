import 'server-only';
import { createAppointment, getAvailableSlots, listStylists, normalizePhone } from '@salon/booking';
import { createPrismaPort } from '@salon/booking/prisma';
import { createDb, type Db } from '@salon/db';
import type { ApiDeps } from './booking-api';
import { getEnv, getKv } from '@salon/security/env';
import { createKvStore, createMemoryStore, createRateLimiter } from '@salon/security/rate-limit';
import { verifyTurnstile } from '@salon/security/turnstile';

// Used when there is no KV binding (local dev). Lives for the life of the server process.
const memoryStore = createMemoryStore();
let warnedAboutMemory = false;

// Local development and CI run one long-lived Node server on plain `pg`, so they share one client
// (building a Prisma client costs far more than a query). Workers must not: a connection cannot be
// kept across requests there, so each request builds and closes its own.
let sharedLocalDb: Db | undefined;

const log: ApiDeps['log'] = (event, data) => console.log(JSON.stringify({ event, ...data }));

/**
 * Builds the real dependencies for one request, runs `run`, and always closes the database
 * connection afterwards (except the shared local one). The database client is created lazily, so a request that is refused early
 * (wrong origin, rate limited, bad input) never opens a connection.
 */
export async function withApiDeps<T>(run: (deps: ApiDeps) => Promise<T>): Promise<T> {
  let db: Db | undefined;
  const database = (): Db => {
    const url = getEnv('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is not set');
    // Workers use the Neon driver; local development and CI use plain `pg`.
    if (getEnv('DB_DRIVER') === 'pg') db ??= sharedLocalDb ??= createDb(url, 'pg');
    else db ??= createDb(url, 'neon');
    return db;
  };
  const port = () => createPrismaPort(database());

  const kv = getKv('RATE_LIMIT');
  if (!kv && !warnedAboutMemory) {
    warnedAboutMemory = true;
    log('rate_limit_store', {
      store: 'memory (no RATE_LIMIT KV binding: fine for local dev only)',
    });
  }

  const deps: ApiDeps = {
    engine: {
      getSlots: (input) => getAvailableSlots(port(), input),
      listStylists: (input) => listStylists(port(), input),
      create: (input) => createAppointment(port(), input),
      // This API only takes online bookings, which need a mobile number.
      normalizePhone: (phone) => normalizePhone(phone, { requireMobile: true }),
    },
    rateLimiter: createRateLimiter(kv ? createKvStore(kv) : memoryStore, {
      onError: (error) =>
        log('rate_limit_store_error', { type: error instanceof Error ? error.name : 'unknown' }),
    }),
    pingDatabase: async () => {
      await database().$queryRaw`SELECT 1`;
    },
    verifyTurnstile: (token, ip) =>
      verifyTurnstile({ token, ip, secret: getEnv('TURNSTILE_SECRET_KEY') }),
    now: () => new Date(),
    log,
  };

  try {
    return await run(deps);
  } finally {
    if (db !== sharedLocalDb) await db?.$disconnect();
  }
}
