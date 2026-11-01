// Load test for the website's two dynamic endpoints. Run against a LOCAL production build:
//   pnpm build && pnpm start        (in one terminal; needs the seeded local Postgres)
//   pnpm load-test                  (in another)
//
// Phase 1, reads: many visitors ask for free times at once (speed and errors).
// Phase 2, contention: many people try to book the SAME slot at once. The database must let exactly
//   one through (or, for "any stylist", no more than there are stylists), and nothing may crash.
//
// Do not point this at the live site: the rate limits (correctly) block one machine, and the booking
// phase needs the local Turnstile test keys. Test bookings use phones starting +919000000 and are
// deleted at the end (the script refuses any database that is not on localhost).
import { readFileSync } from 'node:fs';
import autocannon from 'autocannon';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: new URL('../.env.local', import.meta.url), quiet: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DURATION = Number(process.env.LOAD_SECONDS ?? 10);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 25);
const CONTENDERS = Number(process.env.LOAD_CONTENDERS ?? 30);
// Local, one machine, one Postgres: a tripwire for regressions, not a promise about production.
const MAX_READ_P99_MS = Number(process.env.LOAD_MAX_P99_MS ?? 500);

const catalog = JSON.parse(readFileSync(new URL('../src/generated/catalog.json', import.meta.url), 'utf8'));
const branch = catalog.branches[0];
const service = catalog.catalog.flatMap((c) => c.services).find((s) => s.offers[branch.slug]);

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

let ipCounter = 0;
const fakeIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

const get = async (path) => {
  const response = await fetch(`${BASE}${path}`, { headers: { 'x-forwarded-for': fakeIp() } });
  return { status: response.status, body: await response.json() };
};

/** The first day (from tomorrow) on which this stylist (or 'ANY') has free times, as YYYY-MM-DD. */
async function findDayWithSlots(stylistId) {
  for (let ahead = 1; ahead <= 6; ahead++) {
    const date = new Date(Date.now() + ahead * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const { status, body } = await get(
      `/api/availability?branchId=${branch.id}&serviceIds=${service.id}&date=${date}&stylistId=${stylistId}`,
    );
    if (status === 200 && body.slots.length > 0) return { date, slots: body.slots };
  }
  throw new Error('No free times in the next 6 days: is the local database seeded?');
}

async function readPhase(date) {
  console.log(`\nPhase 1: ${CONNECTIONS} connections reading free times for ${DURATION} s (${BASE})`);
  const result = await autocannon({
    url: `${BASE}/api/availability`,
    connections: CONNECTIONS,
    duration: DURATION,
    requests: [
      {
        method: 'GET',
        path: `/api/availability?branchId=${branch.id}&serviceIds=${service.id}&date=${date}&stylistId=ANY`,
        // A different visitor address each time, so the per-visitor read limit never gets in the way.
        setupRequest: (request) => ({ ...request, headers: { ...request.headers, 'x-forwarded-for': fakeIp() } }),
      },
    ],
  });
  console.log(
    `  ${Math.round(result.requests.average)} requests/s, latency p50 ${result.latency.p50} ms, ` +
      `p97.5 ${result.latency.p97_5} ms, p99 ${result.latency.p99} ms, max ${result.latency.max} ms`,
  );
  check(result['5xx'] === 0, `no server errors in ${result.requests.total} requests (got ${result['5xx']})`);
  check(result.errors === 0 && result.timeouts === 0, `no dropped connections or timeouts`);
  check(result['2xx'] === result.requests.total, 'every read answered 200');
  check(result.latency.p99 <= MAX_READ_P99_MS, `p99 latency ${result.latency.p99} ms is within ${MAX_READ_P99_MS} ms`);
}

async function book({ startAt, stylistId, phoneNo }) {
  const phone = `90000${String(phoneNo).padStart(5, '0')}`;
  const response = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'x-forwarded-for': fakeIp() },
    body: JSON.stringify({
      branchId: branch.id,
      serviceIds: [service.id],
      startAt,
      stylistId,
      name: 'Load Test',
      phone,
      consent: true,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const tally = (results) => results.reduce((counts, r) => ({ ...counts, [r.status]: (counts[r.status] ?? 0) + 1 }), {});

async function contentionPhase(date, slots) {
  const stylistsResponse = await get(`/api/stylists?branchId=${branch.id}&serviceIds=${service.id}`);
  const stylists = stylistsResponse.body.stylists;
  console.log(`\nPhase 2: ${CONTENDERS} people book the same slot at the same moment (${stylists.length} stylists)`);

  // Everyone wants the same named stylist: exactly one can have it.
  const named = stylists[0];
  const target = slots[Math.floor(slots.length / 2)];
  const one = await Promise.all(
    Array.from({ length: CONTENDERS }, (_, i) => book({ startAt: target.startAt, stylistId: named.id, phoneNo: 100 + i })),
  );
  const oneCounts = tally(one);
  console.log(`  same stylist: ${JSON.stringify(oneCounts)}`);
  check((oneCounts[201] ?? 0) === 1, `exactly one booking wins a named stylist's slot (got ${oneCounts[201] ?? 0})`);
  check(Object.keys(oneCounts).every((s) => s === '201' || s === '409'), 'everyone else is told the time is taken (409), no errors or 429s');

  // "Any stylist": as many wins as there are stylists free at that time, never more.
  const other = slots[Math.floor(slots.length / 3)];
  const any = await Promise.all(
    Array.from({ length: CONTENDERS }, (_, i) => book({ startAt: other.startAt, stylistId: 'ANY', phoneNo: 200 + i })),
  );
  const anyCounts = tally(any);
  console.log(`  any stylist: ${JSON.stringify(anyCounts)}`);
  check((anyCounts[201] ?? 0) >= 1, 'at least one "any stylist" booking succeeds');
  check((anyCounts[201] ?? 0) <= stylists.length, `never more winners (${anyCounts[201] ?? 0}) than stylists (${stylists.length})`);
  check(Object.keys(anyCounts).every((s) => s === '201' || s === '409'), 'everyone else is told the time is taken (409), no errors or 429s');
  return { expected: (oneCounts[201] ?? 0) + (anyCounts[201] ?? 0) };
}

async function withDb(run) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see apps/web/.env.example)');
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Refusing to touch a non-local database');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const cleanup = () =>
  withDb(async (db) => {
    await db.query(
      `delete from "Appointment" where "customerId" in (select id from "Customer" where phone like '+919000000%')`,
    );
    await db.query(`delete from "Customer" where phone like '+919000000%'`);
  });

await cleanup();
try {
  // A day when the first stylist works, so the named-stylist contest has real slots to fight over.
  const stylistList = (await get(`/api/stylists?branchId=${branch.id}&serviceIds=${service.id}`)).body.stylists;
  const { date, slots } = await findDayWithSlots(stylistList[0].id);
  await readPhase(date);
  const { expected } = await contentionPhase(date, slots);
  const stored = await withDb((db) =>
    db.query(`select count(*)::int as n from "Appointment" where "customerId" in (select id from "Customer" where phone like '+919000000%')`),
  );
  check(stored.rows[0].n === expected, `the database holds exactly the ${expected} bookings that were confirmed (found ${stored.rows[0].n})`);
} finally {
  await cleanup();
}

console.log(failures.length === 0 ? '\nLoad test passed.' : `\nLoad test FAILED (${failures.length}).`);
process.exit(failures.length === 0 ? 0 : 1);
