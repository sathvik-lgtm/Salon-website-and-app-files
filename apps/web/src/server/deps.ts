import 'server-only';
import { createAppointment, getAvailableSlots, listStylists, normalizePhone } from '@salon/booking';
import { createPrismaPort } from '@salon/booking/prisma';
import { createDb, type Db } from '@salon/db';
import type { ApiDeps } from './booking-api';
import { getEnv, getKv } from './env';
import { createKvStore, createMemoryStore, createRateLimiter } from './rate-limit';
import { verifyTurnstile } from './turnstile';

// Used when there is no KV binding (local dev). Lives for the life of the server process.
const memoryStore = createMemoryStore();
let warnedAboutMemory = false;

const log: ApiDeps['log'] = (event, data) => console.log(JSON.stringify({ event, ...data }));

/**
 * Builds the real dependencies for one request, runs `run`, and always closes the database
 * connection afterwards. The database client is created lazily, so a request that is refused early
 * (wrong origin, rate limited, bad input) never opens a connection.
 */
export async function withApiDeps<T>(run: (deps: ApiDeps) => Promise<T>): Promise<T> {
  let db: Db | undefined;
  const port = () => {
    const url = getEnv('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is not set');
    // Workers use the Neon driver; local development and CI use plain `pg`.
    db ??= createDb(url, getEnv('DB_DRIVER') === 'pg' ? 'pg' : 'neon');
    return createPrismaPort(db);
  };

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
    verifyTurnstile: (token, ip) =>
      verifyTurnstile({ token, ip, secret: getEnv('TURNSTILE_SECRET_KEY') }),
    now: () => new Date(),
    log,
  };

  try {
    return await run(deps);
  } finally {
    await db?.$disconnect();
  }
}
