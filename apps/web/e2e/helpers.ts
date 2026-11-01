import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

/** Every test booking uses a phone number starting with this, so cleanup can find them all. */
export const TEST_PHONE_PREFIX = '+919000000';

/** A test phone number as a customer would type it (no +91). */
export const testPhone = (n: number) => `90000${String(n).padStart(5, '0')}`;

export const BRANCH = 'Placeholder Salon — Branch One';
export const SERVICE = 'Haircut & Style';

async function withDb<T>(run: (client: InstanceType<typeof Client>) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see apps/web/.env.example)');
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

/** Removes every booking and customer the tests created. */
export async function cleanupTestBookings(): Promise<void> {
  await withDb(async (db) => {
    const like = `${TEST_PHONE_PREFIX}%`;
    await db.query(
      'delete from "Appointment" where "customerId" in (select id from "Customer" where phone like $1)',
      [like],
    );
    await db.query('delete from "Customer" where phone like $1', [like]);
  });
}

export interface StoredBooking {
  status: string;
  source: string;
  stylistPreference: string;
  startAt: Date;
  endAt: Date;
  totalPricePaise: number;
  totalDurationMin: number;
  items: number;
  consentAt: Date | null;
}

/** The bookings stored for a test phone number (as typed, without +91). */
export async function bookingsFor(phone: string): Promise<StoredBooking[]> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `select a.status, a.source, a."stylistPreference", a."startAt", a."endAt",
              a."totalPricePaise", a."totalDurationMin", c."consentAt",
              (select count(*)::int from "AppointmentItem" i where i."appointmentId" = a.id) as items
         from "Appointment" a join "Customer" c on c.id = a."customerId"
        where c.phone = $1 order by a."startAt"`,
      [`+91${phone}`],
    );
    return rows as StoredBooking[];
  });
}

/** Fails the test if axe-core finds any WCAG A/AA or best-practice problem on the current page. */
export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect(
    violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

// ---- Driving the booking flow like a customer ----

/** Click a labelled radio/checkbox the way a visitor does (the real input is visually hidden). */
export const choose = (page: Page, text: string | RegExp) =>
  page.locator('label', { hasText: text }).first().click();

export const next = (page: Page) => page.getByRole('button', { name: 'Continue' }).click();

export async function startFlow(page: Page, opts: { service?: string } = {}) {
  await page.goto('/book');
  await expect(page.getByRole('heading', { name: 'Choose a branch' })).toBeVisible();
  await choose(page, BRANCH);
  await next(page);
  await expect(page.getByRole('heading', { name: 'Choose your services' })).toBeVisible();
  await choose(page, opts.service ?? SERVICE);
  await expect(page.getByRole('status').filter({ hasText: /1 service/ })).toBeVisible();
  await next(page);
  await expect(page.getByRole('heading', { name: 'Choose your stylist' })).toBeVisible();
}

/** Picks a stylist by name, or leaves "Any available stylist". Returns the name chosen. */
export async function pickStylist(page: Page, which: 'ANY' | 'FIRST' = 'ANY'): Promise<string> {
  await expect(page.getByText('Any available stylist').first()).toBeVisible();
  if (which === 'FIRST') {
    const label = page
      .locator('label', { has: page.locator('input[name="stylist"]:not([value="ANY"])') })
      .first();
    const name = (await label.locator('span.font-medium').innerText()).trim();
    await label.click();
    await next(page);
    return name;
  }
  await next(page);
  return 'Any available stylist';
}

/**
 * On the date and time step: tries the dates from `skipDays` ahead until one has free times, picks
 * the start time at `timeIndex`, and returns its UTC instant.
 */
export async function pickDateAndTime(
  page: Page,
  { skipDays = 1, timeIndex = 3 }: { skipDays?: number; timeIndex?: number } = {},
): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Choose a date and time' })).toBeVisible();
  const dateLabels = page.locator('label', { has: page.locator('input[name="date"]') });
  const timeLabels = page.locator('label', { has: page.locator('input[name="time"]') });
  const count = await dateLabels.count();
  for (let i = skipDays; i < count; i++) {
    await dateLabels.nth(i).click();
    await expect(page.getByText('Finding free times…')).toHaveCount(0);
    if ((await timeLabels.count()) > timeIndex) {
      const startAt = await timeLabels.nth(timeIndex).locator('input').getAttribute('value');
      await timeLabels.nth(timeIndex).click();
      await next(page);
      return startAt!;
    }
  }
  throw new Error('No date in the booking window has free times: is the database seeded?');
}

/** Fills the details step. Does not submit. */
export async function fillDetails(page: Page, { name, phone }: { name: string; phone: string }) {
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(phone);
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
}

/**
 * Presses Confirm until the booking goes through. Turnstile's check takes a moment to pass, and
 * pressing Confirm before that only shows a "please wait" message (nothing is booked), so retrying
 * is safe.
 */
export async function confirmUntilBooked(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page).toHaveURL(/\/book\/confirmation/, { timeout: 2500 });
  }).toPass({ timeout: 30_000 });
}
