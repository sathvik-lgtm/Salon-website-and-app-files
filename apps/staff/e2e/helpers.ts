import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

export const WEB = 'http://localhost:3000';
export const STAFF = 'http://localhost:3001/admin';

/** Every test booking uses a phone number starting with this, so cleanup finds them all. */
export const TEST_PHONE_PREFIX = '+919000000';
export const testPhone = (n: number) => `90000${String(n).padStart(5, '0')}`;

/** A name no real person has, unique to this run. */
export const RUN = `e2e${Date.now().toString(36)}`;
export const EMAIL_DOMAIN = '@e2e.invalid';

async function withDb<T>(run: (client: InstanceType<typeof Client>) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see apps/staff/.env.example)');
  // These tests write and delete rows: never let them near a real database.
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Refusing to run browser tests against a non-local database');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  withDb(async (db) => (await db.query(text, params)).rows as T[]);

/** The app's own password format (PBKDF2-SHA256, 100k iterations), made here with Node's crypto. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  return `pbkdf2$sha256$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export type Role = 'OWNER' | 'BRANCH_MANAGER' | 'RECEPTIONIST' | 'STYLIST';
export interface TestStaff {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  branchSlug: string;
}

/** Creates a staff account for a test (a stylist also gets haircut + a Mon-Sun 10:00-19:00 shift). */
export async function createStaff(
  key: string,
  role: Role,
  branchSlug: string,
  opts: { mustChangePassword?: boolean } = {},
): Promise<TestStaff> {
  const id = randomUUID();
  const password = `Pass-${key}-${RUN}-Aa1`;
  const email = `${RUN}-${key}${EMAIL_DOMAIN}`;
  const name = `${role === 'STYLIST' ? 'Stylist' : 'Staff'} ${key} ${RUN}`;
  await withDb(async (db) => {
    const branch = (await db.query('select id from "Branch" where slug = $1', [branchSlug]))
      .rows[0];
    await db.query(
      `insert into "Staff" (id, name, email, "passwordHash", "mustChangePassword", role, "homeBranchId", bookable, "updatedAt")
       values ($1, $2, $3, $4, $5, $6::"Role", $7, $8, now())`,
      [
        id,
        name,
        email,
        hashPassword(password),
        opts.mustChangePassword ?? false,
        role,
        branch.id,
        role === 'STYLIST',
      ],
    );
    if (role === 'STYLIST') {
      const service = (await db.query(`select id from "Service" where slug = 'haircut'`)).rows[0];
      await db.query('insert into "StaffService" ("staffId", "serviceId") values ($1, $2)', [
        id,
        service.id,
      ]);
      for (let weekday = 1; weekday <= 7; weekday++) {
        await db.query(
          'insert into "StaffSchedule" (id, "staffId", weekday, "startMinute", "endMinute") values ($1, $2, $3, 600, 1140)',
          [randomUUID(), id, weekday],
        );
      }
    }
  });
  return { id, name, email, password, role, branchSlug };
}

/** Removes everything the tests created: staff, their audit trail, bookings and customers. */
export async function cleanup(): Promise<void> {
  await withDb(async (db) => {
    const staff = (
      await db.query('select id from "Staff" where email like $1', [`%${EMAIL_DOMAIN}`])
    ).rows.map((r) => r.id);
    await db.query('delete from "AuditLog" where "actorId" = any($1)', [staff]);
    await db.query(
      `delete from "AuditLog" where "appointmentId" in (select a.id from "Appointment" a join "Customer" c on c.id = a."customerId" where c.phone like $1)`,
      [`${TEST_PHONE_PREFIX}%`],
    );
    await db.query(
      `delete from "Appointment" where "customerId" in (select id from "Customer" where phone like $1) or "staffId" = any($2)`,
      [`${TEST_PHONE_PREFIX}%`, staff],
    );
    await db.query('delete from "Customer" where phone like $1', [`${TEST_PHONE_PREFIX}%`]);
    await db.query('delete from "StaffSchedule" where "staffId" = any($1)', [staff]);
    await db.query('delete from "StaffService" where "staffId" = any($1)', [staff]);
    await db.query('delete from "Staff" where id = any($1)', [staff]);
  });
}

/** A browser context for one visitor, with its own address so rate limits never mix between tests. */
let visitor = 0;
export function newVisitor(
  browser: Browser,
  viewport = { width: 1280, height: 900 },
): Promise<BrowserContext> {
  const ip = `10.30.${Math.floor(++visitor / 250)}.${(visitor % 250) + 1}`;
  return browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': ip },
  });
}

/** Signs in through the real form (waits for the bot check to pass first). */
export async function signIn(
  page: Page,
  who: Pick<TestStaff, 'email' | 'password'>,
  expectUrl: RegExp | string = STAFF,
) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.waitForFunction(
    () => (document.querySelector('input[name=turnstileToken]') as HTMLInputElement | null)?.value,
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(expectUrl, { timeout: 30_000 });
}

export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(
    violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

/** A same-origin API call from a signed-in page's session (cookies + Origin, like the real app). */
export async function api(page: Page, method: 'GET' | 'POST', path: string, body?: unknown) {
  const response = await page.request.fetch(`${STAFF}/api${path}`, {
    method,
    headers: { Origin: 'http://localhost:3001', 'Content-Type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status(), json: json as Record<string, unknown> | null };
}

// ---- Customers booking on the public website ----

const choose = (page: Page, text: string | RegExp) =>
  page.locator('label', { hasText: text }).first().click();
const next = (page: Page) => page.getByRole('button', { name: 'Continue' }).click();

export interface WebsiteBooking {
  startAt: string;
  date: string;
  stylistName: string;
}

/**
 * Books Haircut & Style at Branch One on the real website, with a named stylist, through the
 * customer's own screens. `skipDays` is how many days ahead to start looking for a free time.
 */
export async function bookOnWebsite(
  page: Page,
  opts: { stylistName: string; name: string; phone: string; skipDays?: number; timeIndex?: number },
): Promise<WebsiteBooking> {
  await page.goto(`${WEB}/book`);
  await expect(page.getByRole('heading', { name: 'Choose a branch' })).toBeVisible();
  await choose(page, 'Branch One');
  await next(page);
  await choose(page, 'Haircut & Style');
  await next(page);
  await expect(page.getByRole('heading', { name: 'Choose your stylist' })).toBeVisible();
  await choose(page, opts.stylistName);
  await next(page);

  const dateLabels = page.locator('label', { has: page.locator('input[name="date"]') });
  const timeLabels = page.locator('label', { has: page.locator('input[name="time"]') });
  const timeIndex = opts.timeIndex ?? 3;
  let startAt = '';
  let date = '';
  for (let i = opts.skipDays ?? 1; i < (await dateLabels.count()); i++) {
    await dateLabels.nth(i).click();
    await expect(page.getByText('Finding free times…')).toHaveCount(0);
    if ((await timeLabels.count()) > timeIndex) {
      const label = timeLabels.nth(timeIndex);
      startAt = (await label.locator('input').getAttribute('value'))!;
      date = (await dateLabels.nth(i).locator('input').getAttribute('value'))!;
      await label.click();
      break;
    }
  }
  if (!startAt) throw new Error('No free time found on the website in the booking window');
  await next(page);

  await page.getByRole('textbox', { name: 'Your name' }).fill(opts.name);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(opts.phone);
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await expect(async () => {
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page).toHaveURL(/\/book\/confirmation/, { timeout: 2500 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  return { startAt, date, stylistName: opts.stylistName };
}

/** The newest booking for a test customer's phone number (as typed, without +91). */
export async function bookingFor(phone: string) {
  const [row] = await sql<{
    id: string;
    branchId: string;
    customerId: string;
    status: string;
    staffId: string;
  }>(
    `select a.id, a."branchId", a."customerId", a.status, a."staffId" from "Appointment" a
       join "Customer" c on c.id = a."customerId" where c.phone = $1 order by a."createdAt" desc limit 1`,
    [`+91${phone}`],
  );
  return row!;
}

// ---- Quick bookings through the website's API (for tests that need a booking but are not about booking) ----

let apiVisitor = 0;
const apiIp = () => `10.31.${Math.floor(++apiVisitor / 250)}.${(apiVisitor % 250) + 1}`;

/** Ids the website API needs for Haircut & Style at Branch One. */
export async function branchOneIds() {
  const [branch] = await sql<{ id: string }>(`select id from "Branch" where slug = 'branch-one'`);
  const [service] = await sql<{ id: string }>(`select id from "Service" where slug = 'haircut'`);
  return { branchId: branch!.id, serviceId: service!.id };
}

/** A free start time for a stylist: the website's own availability answer, `daysAhead` days from now. */
export async function freeSlot(
  request: APIRequestContext,
  stylistId: string,
  daysAhead: number,
  index = 3,
) {
  const { branchId, serviceId } = await branchOneIds();
  const date = new Date(Date.now() + daysAhead * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  const response = await request.get(
    `${WEB}/api/availability?branchId=${branchId}&serviceIds=${serviceId}&date=${date}&stylistId=${stylistId}`,
    { headers: { 'x-forwarded-for': apiIp() } },
  );
  const { slots } = (await response.json()) as { slots: { time: string; startAt: string }[] };
  if (!slots?.[index]) throw new Error(`no free slot on ${date} for the test stylist`);
  return { date, startAt: slots[index].startAt, slots };
}

/** Books Haircut & Style the way the website does, without the screens. Returns the booking row. */
export async function bookViaApi(
  request: APIRequestContext,
  opts: { stylistId: string; startAt: string; name: string; phone: string },
) {
  const { branchId, serviceId } = await branchOneIds();
  const response = await request.post(`${WEB}/api/bookings`, {
    headers: { Origin: WEB, 'x-forwarded-for': apiIp() },
    data: {
      branchId,
      serviceIds: [serviceId],
      startAt: opts.startAt,
      stylistId: opts.stylistId,
      name: opts.name,
      phone: opts.phone,
      consent: true,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return bookingFor(opts.phone);
}
