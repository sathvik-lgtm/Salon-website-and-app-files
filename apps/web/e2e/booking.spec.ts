import { readFile } from 'node:fs/promises';
import { expect, test, type Browser } from '@playwright/test';
import {
  SERVICE,
  bookingsFor,
  cleanupTestBookings,
  choose,
  confirmUntilBooked,
  expectNoAxeViolations,
  fillDetails,
  next,
  pickDateAndTime,
  pickStylist,
  startFlow,
  testPhone,
} from './helpers';

// The booking tests share one database and one set of stylists, so they run one after another and
// clean up every booking they make (all test phones start with +919000000).
test.describe.configure({ mode: 'serial' });
test.beforeAll(cleanupTestBookings);
test.afterAll(cleanupTestBookings);

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** A visitor with their own address, so the per-IP rate limit never mixes tests together. */
const newVisitor = (browser: Browser, ip: number, viewport = DESKTOP) =>
  browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': `10.20.0.${ip}` },
  });

const noHorizontalScroll = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const toIcsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

for (const [label, viewport, ip, phoneNo, skipDays] of [
  ['on a desktop', DESKTOP, 1, 71, 1],
  ['on a phone', PHONE, 2, 72, 2],
] as const) {
  test(`a customer books an appointment from start to finish ${label}`, async ({ browser }) => {
    const context = await newVisitor(browser, ip, viewport);
    const page = await context.newPage();
    const phone = testPhone(phoneNo);

    await startFlow(page);
    await expect(page.getByRole('heading', { name: 'Choose your stylist' })).toBeFocused(); // focus follows the steps
    await pickStylist(page, 'ANY');
    const startAt = await pickDateAndTime(page, { skipDays });
    await fillDetails(page, {
      name: 'E2E Customer',
      phone: `${phone.slice(0, 5)} ${phone.slice(5)}`,
    });
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await confirmUntilBooked(page);

    // The confirmation shows everything the customer needs.
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    const main = page.locator('main');
    await expect(main).toContainText('Placeholder Salon — Branch One');
    await expect(main).toContainText(SERVICE);
    await expect(main).toContainText('₹600');
    await expect(main).toContainText('45 min');
    await expect(main.getByText('Reference').locator('xpath=following-sibling::dd')).toHaveText(
      /^[0-9A-Z]{8}$/,
    );
    await expect(main.locator('a[href^="tel:+91"]')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page, 'the confirmation page');

    // "Add to calendar" downloads a real .ics file for exactly this appointment.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Add to calendar' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^appointment-\d{4}-\d{2}-\d{2}\.ics$/);
    const ics = await readFile((await download.path())!, 'utf8');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain(`DTSTART:${toIcsTime(startAt)}`);
    expect(ics).toContain('SUMMARY:Haircut & Style at Placeholder Salon');

    // It is really in the database, confirmed, with the server's own price, time and consent.
    const stored = await bookingsFor(phone);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: 'CONFIRMED',
      source: 'ONLINE',
      stylistPreference: 'ANY_AVAILABLE',
      totalPricePaise: 60000,
      totalDurationMin: 45,
      items: 1,
    });
    expect(stored[0]!.startAt.toISOString()).toBe(startAt);
    expect(stored[0]!.consentAt).not.toBeNull();

    // A refresh keeps the confirmation; another browser (no booking in it) shows the fallback.
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    const stranger = await newVisitor(browser, ip + 100, viewport);
    const other = await stranger.newPage();
    await other.goto('/book/confirmation');
    await expect(
      other.getByRole('heading', { name: "We can't show your booking here" }),
    ).toBeVisible();
    await expectNoAxeViolations(other, 'the confirmation page without a booking');
    await context.close();
    await stranger.close();
  });
}

test('two customers racing for the same slot: one is booked, the other is told and can choose again', async ({
  browser,
}) => {
  const a = await newVisitor(browser, 3);
  const b = await newVisitor(browser, 4);
  const [pageA, pageB] = [await a.newPage(), await b.newPage()];
  const [phoneA, phoneB] = [testPhone(73), testPhone(74)];

  // Both pick the same stylist, the same day and the same start time...
  const startAts: string[] = [];
  for (const [page, phone] of [
    [pageA, phoneA],
    [pageB, phoneB],
  ] as const) {
    await startFlow(page);
    await pickStylist(page, 'FIRST');
    startAts.push(await pickDateAndTime(page, { skipDays: 3, timeIndex: 6 }));
    await fillDetails(page, { name: 'Race Customer', phone });
  }
  expect(startAts[0]).toBe(startAts[1]);

  // ...then A confirms first.
  await confirmUntilBooked(pageA);
  await expect(pageA.getByRole('heading', { name: "You're booked" })).toBeVisible();

  // B presses Confirm for a slot that has just gone.
  await expect(async () => {
    await pageB.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(pageB.getByRole('alert').filter({ hasText: 'has just been taken' })).toBeVisible({
      timeout: 2500,
    });
  }).toPass({ timeout: 30_000 });

  // B is sent back to the times, which are refreshed and no longer offer that slot.
  await expect(pageB.getByRole('heading', { name: 'Choose a date and time' })).toBeVisible();
  await expect(pageB.locator('input[name="time"]').first()).toBeAttached();
  await expect(pageB.locator(`input[name="time"][value="${startAts[0]}"]`)).toHaveCount(0);
  expect(await bookingsFor(phoneB)).toHaveLength(0); // nothing was booked for B

  // B picks another time; the details they typed are still there. This time it works.
  await pageB
    .locator('label', { has: pageB.locator('input[name="time"]') })
    .first()
    .click();
  await next(pageB);
  await expect(pageB.getByRole('textbox', { name: 'Your name' })).toHaveValue('Race Customer');
  await confirmUntilBooked(pageB);
  await expect(pageB.getByRole('heading', { name: "You're booked" })).toBeVisible();

  const [bookedA, bookedB] = [await bookingsFor(phoneA), await bookingsFor(phoneB)];
  expect(bookedA).toHaveLength(1);
  expect(bookedB).toHaveLength(1);
  expect(bookedA[0]!.startAt.toISOString()).toBe(startAts[0]);
  expect(bookedB[0]!.startAt.toISOString()).not.toBe(startAts[0]);
  await a.close();
  await b.close();
});

test('the details step explains mistakes and moves focus to the first one', async ({ browser }) => {
  const context = await newVisitor(browser, 5);
  const page = await context.newPage();
  await startFlow(page);
  await pickStylist(page, 'ANY');
  await pickDateAndTime(page, { skipDays: 1 });
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();

  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Please enter your name.')).toBeVisible();
  await expect(page.getByText('Please enter your mobile number.')).toBeVisible();
  await expect(page.getByText('Please tick the box to continue.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expectNoAxeViolations(page, 'the details step showing errors');

  // A number the server rejects: the message says so and the phone field is focused.
  await page.getByRole('textbox', { name: 'Your name' }).fill('Phone Check');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('1234567890');
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await expect(async () => {
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'does not look right' })).toBeVisible({
      timeout: 2500,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toBeFocused();
  expect(await bookingsFor('1234567890')).toHaveLength(0);
  await context.close();
});

test('the branch from the services page or a branch link is preselected', async ({ browser }) => {
  const context = await newVisitor(browser, 6);
  const page = await context.newPage();
  await page.goto('/book?branch=branch-three');
  await expect(page.getByRole('radio', { name: /Branch Three/ })).toBeChecked();
  await page.goto('/book');
  await expect(page.getByRole('radio', { name: /Branch Three/ })).not.toBeChecked(); // the link does not stick on its own

  await context.addCookies([
    { name: 'salon_branch', value: 'branch-two', url: 'http://localhost:3000' },
  ]);
  await page.goto('/book');
  await expect(page.getByRole('radio', { name: /Branch Two/ })).toBeChecked();
  await page.goto('/book?branch=branch-one'); // the link beats the cookie
  await expect(page.getByRole('radio', { name: /Branch One/ })).toBeChecked();
  await context.close();
});

test('every step of the flow is accessible, and each step moves focus to its heading', async ({
  browser,
}) => {
  const context = await newVisitor(browser, 7);
  const page = await context.newPage();
  await page.goto('/book');
  await expectNoAxeViolations(page, 'step 1 (branch)');
  await choose(page, 'Branch One');
  await next(page);
  await expect(page.getByRole('heading', { name: 'Choose your services' })).toBeFocused();
  await choose(page, SERVICE);
  await expectNoAxeViolations(page, 'step 2 (services)');
  await next(page);
  await expect(page.getByRole('heading', { name: 'Choose your stylist' })).toBeFocused();
  await pickStylist(page, 'ANY');
  await expect(page.getByRole('heading', { name: 'Choose a date and time' })).toBeFocused();
  await pickDateAndTime(page, { skipDays: 1 });
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeFocused();
  await expectNoAxeViolations(page, 'step 5 (details)');
  await context.close();
});

test('going back and changing an earlier choice clears what no longer fits', async ({
  browser,
}) => {
  const context = await newVisitor(browser, 8);
  const page = await context.newPage();
  await startFlow(page);
  await pickStylist(page, 'FIRST');
  await expect(page.getByRole('heading', { name: 'Choose a date and time' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click(); // to stylist
  await page.getByRole('button', { name: 'Back' }).click(); // to services
  await choose(page, 'Blow Dry'); // add a second service
  await expect(page.getByRole('status').filter({ hasText: /2 services/ })).toBeVisible();
  await next(page);
  // The stylist choice was reset, because the qualified stylists can differ for the new set.
  await expect(page.locator('input[name="stylist"][value="ANY"]')).toBeChecked();
  await context.close();
});
