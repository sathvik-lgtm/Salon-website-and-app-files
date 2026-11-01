import { expect, test, type Page } from '@playwright/test';
import {
  STAFF,
  WEB,
  api,
  bookOnWebsite,
  bookViaApi,
  bookingFor,
  branchOneIds,
  cleanup,
  createStaff,
  freeSlot,
  newVisitor,
  signIn,
  sql,
  testPhone,
  type TestStaff,
  type WebsiteBooking,
} from './helpers';

/**
 * The staff app against the real website and the real database: a booking made by a customer shows
 * up for staff, and nobody can reach another branch's data. Runs one test after another because the
 * tests share one booking. Every account and booking is created here and removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

let stylist: TestStaff;
let recepOne: TestStaff;
let recepTwo: TestStaff;
let managerOne: TestStaff;
let owner: TestStaff;

const CUSTOMER = 'Website Customer';
const PHONE = testPhone(81);
let website: WebsiteBooking;
let bookingRow: Awaited<ReturnType<typeof bookingFor>>;

test.beforeAll(async () => {
  await cleanup();
  stylist = await createStaff('stylist', 'STYLIST', 'branch-one');
  recepOne = await createStaff('recep1', 'RECEPTIONIST', 'branch-one');
  recepTwo = await createStaff('recep2', 'RECEPTIONIST', 'branch-two');
  managerOne = await createStaff('manager1', 'BRANCH_MANAGER', 'branch-one');
  owner = await createStaff('owner1', 'OWNER', 'branch-one');
});
test.afterAll(cleanup);

/** "10:15 am", the way the staff app shows a time, for an instant in the branch's timezone. */
const clock = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase();

async function openCalendarOn(page: Page, date: string) {
  await page.goto(`${STAFF}/calendar`);
  await page.getByLabel('Go to date').fill(date);
  await expect(page.getByRole('region', { name: 'Day schedule' })).toBeVisible();
}

test("a booking made on the website appears in the staff app, in the right stylist's column", async ({
  browser,
}) => {
  // A customer books on the real website...
  const customer = await newVisitor(browser);
  website = await bookOnWebsite(await customer.newPage(), {
    stylistName: stylist.name,
    name: CUSTOMER,
    phone: PHONE,
    skipDays: 1,
  });
  await customer.close();
  bookingRow = await bookingFor(PHONE);

  // ...and a receptionist at that branch sees it.
  const staff = await newVisitor(browser);
  const page = await staff.newPage();
  await signIn(page, recepOne);
  await openCalendarOn(page, website.date);

  const card = page.getByRole('link', { name: new RegExp(`${CUSTOMER}.*with ${stylist.name}`) });
  await expect(card).toBeVisible();

  // It sits in the column headed by that stylist (a real layout check, not just a text match).
  const header = (await page.getByRole('heading', { name: stylist.name, level: 2 }).boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(header.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width + 1);

  // Opening it shows everything the front desk needs.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/admin/bookings/${bookingRow.id}$`));
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: CUSTOMER })).toBeVisible();
  await expect(main).toContainText('Haircut & Style');
  await expect(main).toContainText(stylist.name);
  await expect(main).toContainText('Confirmed');
  await expect(main).toContainText('Online');
  await expect(main).toContainText(clock(website.startAt));
  await expect(main.getByRole('link', { name: '+91 90000 00081' })).toHaveAttribute(
    'href',
    'tel:+919000000081',
  );
  await staff.close();
});

test.describe('nobody can reach another branch', () => {
  test('a receptionist at Branch Two cannot read or change the Branch One booking, by any route', async ({
    browser,
  }) => {
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await signIn(page, recepTwo);
    const { branchId, serviceId } = await branchOneIds();

    // Reading: forbidden or "not found", exactly like something that does not exist.
    expect(
      (await api(page, 'GET', `/schedule?branchId=${branchId}&date=${website.date}&view=day`))
        .status,
    ).toBe(403);
    expect((await api(page, 'GET', `/bookings/${bookingRow.id}`)).status).toBe(404);
    expect((await api(page, 'GET', '/bookings/no-such-booking')).status).toBe(404); // same answer: nothing is confirmed
    expect((await api(page, 'GET', `/clients/${bookingRow.customerId}`)).status).toBe(404);
    const search = await api(page, 'GET', `/clients?q=${encodeURIComponent('90000 00081')}`);
    expect(search.json?.clients).toEqual([]); // that customer has never been to Branch Two
    for (const path of [
      `/services?branchId=${branchId}`,
      `/stylists?branchId=${branchId}&serviceIds=${serviceId}`,
      `/slots?branchId=${branchId}&serviceIds=${serviceId}&date=${website.date}`,
    ]) {
      expect((await api(page, 'GET', path)).status, path).toBe(403);
    }

    // Changing: refused, and the booking is untouched.
    for (const to of ['CHECKED_IN', 'CANCELLED', 'NO_SHOW']) {
      expect((await api(page, 'POST', `/bookings/${bookingRow.id}/status`, { to })).status).toBe(
        404,
      );
    }
    const make = await api(page, 'POST', '/bookings', {
      branchId,
      serviceIds: [serviceId],
      startAt: website.startAt,
      stylistId: 'ANY',
      name: 'Intruder One',
      phone: testPhone(99),
      source: 'PHONE',
    });
    expect(make.status).toBe(403);
    const [row] = await sql<{ status: string }>('select status from "Appointment" where id = $1', [
      bookingRow.id,
    ]);
    expect(row?.status).toBe('CONFIRMED');
    expect(
      await sql('select 1 from "Customer" where phone = $1', [`+91${testPhone(99)}`]),
    ).toHaveLength(0);

    // The screens say the same.
    await page.goto(`${STAFF}/bookings/${bookingRow.id}`);
    await expect(page.getByRole('heading', { name: 'Booking not found' })).toBeVisible();
    await openCalendarOn(page, website.date);
    await expect(page.getByText(CUSTOMER)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Branch' })).toHaveCount(0); // no branch switcher: there is only their own
    await ctx.close();
  });

  test('an owner can see every branch; a manager only their own', async ({ browser }) => {
    const [branchTwo] = await sql<{ id: string }>(
      `select id from "Branch" where slug = 'branch-two'`,
    );
    const ownerCtx = await newVisitor(browser);
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    expect(
      (
        await api(
          ownerPage,
          'GET',
          `/schedule?branchId=${branchTwo!.id}&date=${website.date}&view=day`,
        )
      ).status,
    ).toBe(200);
    expect((await api(ownerPage, 'GET', `/bookings/${bookingRow.id}`)).status).toBe(200);
    await ownerPage.goto(`${STAFF}/calendar`);
    await expect(ownerPage.getByRole('combobox', { name: 'Branch' })).toBeVisible(); // an owner can switch branch
    await ownerCtx.close();

    const mgrCtx = await newVisitor(browser);
    const mgrPage = await mgrCtx.newPage();
    await signIn(mgrPage, managerOne);
    expect(
      (
        await api(
          mgrPage,
          'GET',
          `/schedule?branchId=${branchTwo!.id}&date=${website.date}&view=day`,
        )
      ).status,
    ).toBe(403);
    expect((await api(mgrPage, 'GET', `/bookings/${bookingRow.id}`)).status).toBe(200);
    await mgrCtx.close();
  });

  test('an unsigned visitor gets nothing: pages redirect to sign-in and the API says 401', async ({
    browser,
  }) => {
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    for (const path of [
      '',
      '/calendar',
      '/new',
      '/clients',
      '/team',
      `/bookings/${bookingRow.id}`,
    ]) {
      await page.goto(`${STAFF}${path}`);
      await expect(page, path).toHaveURL(`${STAFF}/login`);
    }
    for (const path of [
      `/bookings/${bookingRow.id}`,
      '/team',
      '/clients?q=9000',
      `/schedule?branchId=x&date=${website.date}`,
    ]) {
      expect((await api(page, 'GET', path)).status, path).toBe(401);
    }
    expect(
      (await api(page, 'POST', `/bookings/${bookingRow.id}/status`, { to: 'CANCELLED' })).status,
    ).toBe(401);
    await ctx.close();
  });
});

test('a stylist sees their own booking without the phone number, and cannot change anything', async ({
  browser,
}) => {
  const ctx = await newVisitor(browser);
  const page = await ctx.newPage();
  await signIn(page, stylist);
  await expect(page.getByRole('navigation', { name: 'Main' })).not.toContainText('New booking');
  await expect(page.getByRole('navigation', { name: 'Main' })).not.toContainText('Clients');

  await openCalendarOn(page, website.date);
  const card = page.getByRole('link', { name: new RegExp(CUSTOMER) });
  await expect(card).toBeVisible();
  await card.click();
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: CUSTOMER })).toBeVisible(); // who is coming...
  await expect(main).not.toContainText('90000 00081'); // ...but not their number
  await expect(main.getByRole('button', { name: /Check in|Cancel|no-show|Complete/ })).toHaveCount(
    0,
  );
  await expect(main).toContainText('read-only');

  expect((await api(page, 'GET', '/clients?q=90000')).status).toBe(403);
  expect((await api(page, 'GET', '/team')).status).toBe(403);
  expect(
    (await api(page, 'POST', `/bookings/${bookingRow.id}/status`, { to: 'CHECKED_IN' })).status,
  ).toBe(403);
  await page.goto(`${STAFF}/new`);
  await expect(page).toHaveURL(STAFF); // sent home: stylists cannot book
  await ctx.close();
});

test('front desk checks a customer in and completes the visit, and the history shows who did what', async ({
  browser,
}) => {
  const ctx = await newVisitor(browser);
  const page = await ctx.newPage();
  await signIn(page, recepOne);
  await page.goto(`${STAFF}/bookings/${bookingRow.id}`);
  await expect(page.getByRole('heading', { name: CUSTOMER })).toBeVisible();

  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText('Checked in.', { exact: true })).toBeVisible();
  expect((await bookingFor(PHONE)).status).toBe('CHECKED_IN');

  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('Marked complete.', { exact: true })).toBeVisible();
  expect((await bookingFor(PHONE)).status).toBe('COMPLETED');
  await expect(page.getByText('This booking is finished, so it cannot be changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cancel|no-show/ })).toHaveCount(0);

  const history = page.locator('section[aria-labelledby="history"] li');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText('Checked in → Completed');
  await expect(history.last()).toContainText('Confirmed → Checked in');
  await expect(history.first()).toContainText(recepOne.name);
  await ctx.close();
});

test('cancelling asks first, cannot be undone, and frees the time for the website at once', async ({
  browser,
  request,
}) => {
  const slot = await freeSlot(request, stylist.id, 3, 5);
  const row = await bookViaApi(request, {
    stylistId: stylist.id,
    startAt: slot.startAt,
    name: 'Cancel Customer',
    phone: testPhone(82),
  });
  const { branchId, serviceId } = await branchOneIds();
  const offered = async () => {
    const r = await request.get(
      `${WEB}/api/availability?branchId=${branchId}&serviceIds=${serviceId}&date=${slot.date}&stylistId=${stylist.id}`,
    );
    return ((await r.json()) as { slots: { startAt: string }[] }).slots.some(
      (s) => s.startAt === slot.startAt,
    );
  };
  expect(await offered()).toBe(false); // taken while the booking stands

  const ctx = await newVisitor(browser);
  const page = await ctx.newPage();
  await signIn(page, recepOne);
  await page.goto(`${STAFF}/bookings/${row.id}`);
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Cancel this booking?');
  await page.getByRole('button', { name: 'No, keep it' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await bookingFor(testPhone(82))).status).toBe('CONFIRMED'); // "keep it" really keeps it

  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByText('Booking cancelled. The time is free again.')).toBeVisible();
  expect((await bookingFor(testPhone(82))).status).toBe('CANCELLED');
  expect(await offered()).toBe(true); // the website offers that time again
  await expect(page.getByRole('button', { name: /Check in|Cancel|no-show|Complete/ })).toHaveCount(
    0,
  );
  await ctx.close();
});

test('a phone booking at an odd time goes through the same engine, then the same time is refused', async ({
  browser,
}) => {
  const ctx = await newVisitor(browser);
  const page = await ctx.newPage();
  await signIn(page, recepOne);
  const date = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  const phone = testPhone(83);

  async function fill() {
    await page.goto(`${STAFF}/new`);
    await expect(page.getByRole('heading', { name: 'New booking' })).toBeVisible();
    await page.locator('label', { hasText: 'Haircut & Style' }).click();
    await expect(page.getByRole('option', { name: stylist.name })).toBeAttached();
    await page.getByLabel('Stylist').selectOption({ label: stylist.name });
    await page.getByLabel('Date', { exact: true }).fill(date);
    await page.getByLabel('Start time').fill('15:07'); // not on the website's 5-minute grid
    await page.locator('label', { hasText: 'By phone' }).click();
    await page.getByRole('textbox', { name: /^Name/ }).fill('Phone Customer');
    await page
      .getByRole('textbox', { name: /^Phone number/ })
      .fill(`${phone.slice(0, 5)} ${phone.slice(5)}`);
    await page.getByRole('button', { name: 'Book it' }).click();
  }

  await fill();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  await expect(page.locator('main')).toContainText(`Haircut & Style with ${stylist.name}`);
  await expect(page.locator('main')).toContainText('3:07 pm');

  const [stored] = await sql<{ source: string; startAt: Date; status: string }>(
    `select a.source, a."startAt", a.status from "Appointment" a join "Customer" c on c.id = a."customerId" where c.phone = $1`,
    [`+91${phone}`],
  );
  expect(stored).toMatchObject({ source: 'PHONE', status: 'CONFIRMED' });
  expect(stored!.startAt.toISOString()).toBe(new Date(`${date}T15:07:00+05:30`).toISOString());
  const audit = await sql(
    'select action, detail from "AuditLog" where "actorId" = $1 and action = $2',
    [recepOne.id, 'CREATE_BOOKING'],
  );
  expect(audit).toHaveLength(1);

  await page.getByRole('link', { name: 'Open the booking' }).click();
  await expect(page.locator('main')).toContainText('Phone,');
  await expect(page.getByText('Booked at the desk (Phone)')).toBeVisible();

  // The same stylist and time again: refused plainly, nothing double booked.
  await fill();
  await expect(page.getByRole('alert').filter({ hasText: 'not free' })).toBeVisible();
  expect(
    await sql(
      'select 1 from "Customer" c join "Appointment" a on a."customerId" = c.id where c.phone = $1',
      [`+91${phone}`],
    ),
  ).toHaveLength(1);
  await ctx.close();
});

test('"Start right now" fills in the branch\'s current date and time, not the computer\'s', async ({
  browser,
}) => {
  // A computer whose clock says 09:37 UTC on 5 Jan 2027 is 15:07 on the 5th in Kolkata.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: { 'x-forwarded-for': '10.32.0.1' },
  });
  const page = await ctx.newPage();
  await signIn(page, recepOne);
  await page.clock.setFixedTime(new Date('2027-01-05T09:37:00Z'));
  await page.goto(`${STAFF}/new`);
  await page.getByRole('button', { name: 'Start right now' }).click();
  await expect(page.getByLabel('Start time')).toHaveValue('15:07');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2027-01-05');
  await ctx.close();
});

test('a booking made while the schedule is open appears by itself within about 20 seconds, marked as new', async ({
  browser,
  request,
}) => {
  const ctx = await newVisitor(browser);
  const page = await ctx.newPage();
  await signIn(page, recepOne);
  const slot = await freeSlot(request, stylist.id, 4, 8);
  await openCalendarOn(page, slot.date);
  await expect(page.getByRole('status').filter({ hasText: /\d+ bookings?/ })).toBeVisible(); // first load done
  const arriving = page.getByRole('link', { name: /Arriving Customer/ });
  await expect(arriving).toHaveCount(0);

  await bookViaApi(request, {
    stylistId: stylist.id,
    startAt: slot.startAt,
    name: 'Arriving Customer',
    phone: testPhone(84),
  });
  await expect(arriving).toBeVisible({ timeout: 45_000 }); // no refresh pressed
  await expect(arriving).toContainText('New');
  await ctx.close();
});
