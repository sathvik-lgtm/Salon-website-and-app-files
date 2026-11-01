import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  STAFF,
  api,
  bookViaApi,
  cleanup,
  createStaff,
  expectNoAxeViolations,
  freeSlot,
  newVisitor,
  signIn,
  sql,
  testPhone,
  type TestStaff,
} from './helpers';

/** Sign-in, passwords, sessions, installability and accessibility of the staff app. */
test.describe.configure({ mode: 'serial' });

let manager: TestStaff;
let receptionist: TestStaff;

test.beforeAll(async () => {
  await cleanup();
  manager = await createStaff('manager', 'BRANCH_MANAGER', 'branch-one');
  receptionist = await createStaff('recep', 'RECEPTIONIST', 'branch-one');
});
test.afterAll(cleanup);

/** One sign-in attempt through the form, returning what the person is told. */
async function attempt(page: Page, email: string, password: string) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.waitForFunction(
    () => (document.querySelector('input[name=turnstileToken]') as HTMLInputElement | null)?.value,
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  const alert = page.getByRole('alert').filter({ hasText: /\w/ });
  await Promise.race([
    alert.waitFor({ timeout: 20_000 }),
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 }),
  ]);
  // Success is leaving the sign-in page (the page-title announcement is also an alert, so it cannot be used).
  if (!new URL(page.url()).pathname.endsWith('/login')) return null;
  return (await alert.first().innerText()).trim();
}

test.describe('temporary passwords', () => {
  test("a manager resets a colleague's password; the colleague must then choose their own", async ({
    browser,
  }) => {
    const colleague = await createStaff('colleague', 'RECEPTIONIST', 'branch-one');
    const manager2 = await createStaff('manager2', 'BRANCH_MANAGER', 'branch-one');
    const otherBranch = await createStaff('elsewhere', 'RECEPTIONIST', 'branch-two');

    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await signIn(page, manager);
    await page.getByRole('link', { name: 'Team' }).click();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

    // Who is on the list, and who can be reset.
    const row = (name: string) => page.getByRole('row', { name: new RegExp(name) });
    await expect(row(colleague.name)).toBeVisible();
    await expect(row(otherBranch.name)).toHaveCount(0); // a manager sees only their own branch
    await expect(row(manager2.name).getByRole('button')).toHaveCount(0); // an equal: no reset button
    await expect(row(manager.name).getByRole('button')).toHaveCount(0); // themselves: use "Password" instead
    await expect(row(colleague.name).getByRole('button')).toHaveCount(1);

    await row(colleague.name)
      .getByRole('button', { name: /Set temporary password/ })
      .click();
    await row(colleague.name).getByRole('button', { name: 'No' }).click(); // asked first, and can back out
    expect(
      await sql('select 1 from "AuditLog" where "actorId" = $1 and action = $2', [
        manager.id,
        'PASSWORD_RESET',
      ]),
    ).toHaveLength(0);

    await row(colleague.name)
      .getByRole('button', { name: /Set temporary password/ })
      .click();
    await row(colleague.name).getByRole('button', { name: 'Yes, set it' }).click();
    const shown = page.getByTestId('temporary-password');
    await expect(shown).toBeVisible();
    const temporary = (await shown.innerText()).trim();
    expect(temporary).toHaveLength(14);
    await expect(page.getByText('This is shown only once.')).toBeVisible();
    await page.getByRole('button', { name: 'Done, hide it' }).click();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0); // it cannot be shown again
    await expect(row(colleague.name)).toContainText('Must choose a new password');

    // Recorded, without the password.
    const audit = await sql<{ detail: unknown }>(
      'select detail from "AuditLog" where "actorId" = $1 and action = $2',
      [manager.id, 'PASSWORD_RESET'],
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(temporary);
    await ctx.close();

    // The colleague: the old password is dead, the temporary one forces a change.
    const theirs = await newVisitor(browser);
    const theirPage = await theirs.newPage();
    expect(await attempt(theirPage, colleague.email, colleague.password)).toMatch(/not right/);
    expect(await attempt(theirPage, colleague.email, temporary)).toBeNull();
    await expect(theirPage).toHaveURL(`${STAFF}/change-password`);
    await theirPage.goto(`${STAFF}/calendar`); // cannot skip it
    await expect(theirPage).toHaveURL(`${STAFF}/change-password`);

    await theirPage.getByLabel('Temporary password').fill(temporary);
    await theirPage.getByLabel('New password', { exact: true }).fill('aaaaaaaaaaaa');
    await theirPage.getByLabel('New password again').fill('aaaaaaaaaaaa');
    await theirPage.getByRole('button', { name: 'Save new password' }).click();
    await expect(theirPage.getByRole('alert').filter({ hasText: /\w/ })).toContainText(
      'different characters',
    );
    await theirPage.getByLabel('Temporary password').fill(temporary);
    await theirPage.getByLabel('New password', { exact: true }).fill('a-much-better-password-9');
    await theirPage.getByLabel('New password again').fill('a-much-better-password-OTHER');
    await theirPage.getByRole('button', { name: 'Save new password' }).click();
    await expect(theirPage.getByRole('alert').filter({ hasText: /\w/ })).toContainText(
      'do not match',
    );
    await theirPage.getByLabel('Temporary password').fill(temporary);
    await theirPage.getByLabel('New password', { exact: true }).fill('a-much-better-password-9');
    await theirPage.getByLabel('New password again').fill('a-much-better-password-9');
    await theirPage.getByRole('button', { name: 'Save new password' }).click();
    await expect(theirPage).toHaveURL(STAFF);
    await expect(theirPage.getByRole('heading', { name: 'Today' })).toBeVisible();

    // A receptionist has no Team page, in the menu, on the screen or in the API.
    await expect(theirPage.getByRole('navigation', { name: 'Main' })).not.toContainText('Team');
    await theirPage.goto(`${STAFF}/team`);
    await expect(theirPage).toHaveURL(STAFF);
    expect((await api(theirPage, 'GET', '/team')).status).toBe(403);
    expect(
      (await api(theirPage, 'POST', `/team/${receptionist.id}/temporary-password`, {})).status,
    ).toBe(403);
    await theirs.close();
  });

  test("the temporary password cannot be used to reset someone outside the manager's reach", async ({
    browser,
  }) => {
    const elsewhere = (
      await sql<{ id: string }>(`select id from "Staff" where email like $1`, [
        `%elsewhere${'@e2e.invalid'}`,
      ])
    )[0]!;
    const owner = (
      await sql<{ id: string }>(`select id from "Staff" where email like $1`, [
        `%manager2@e2e.invalid`,
      ])
    )[0]!;
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await signIn(page, manager);
    expect((await api(page, 'POST', `/team/${elsewhere.id}/temporary-password`, {})).status).toBe(
      404,
    ); // other branch
    expect((await api(page, 'POST', `/team/${owner.id}/temporary-password`, {})).status).toBe(403); // an equal
    expect((await api(page, 'POST', `/team/${manager.id}/temporary-password`, {})).status).toBe(
      403,
    ); // themselves
    await ctx.close();
  });
});

test.describe('sign-in security and sessions', () => {
  test('5 wrong passwords lock that email from that address (even for the right password) but not from elsewhere', async ({
    browser,
  }) => {
    const lockee = await createStaff('lockee', 'RECEPTIONIST', 'branch-one');
    const here = await newVisitor(browser);
    const herePage = await here.newPage();
    for (let i = 0; i < 5; i++)
      expect(await attempt(herePage, lockee.email, `wrong-password-${i}`)).toMatch(/not right/);
    expect(await attempt(herePage, lockee.email, lockee.password)).toMatch(/Too many attempts/); // right password, still locked
    // The message is the same for an email that does not exist, so it reveals nothing.
    expect(await attempt(herePage, `nobody-${lockee.email}`, 'whatever-password')).toMatch(
      /not right/,
    );

    const elsewhere = await newVisitor(browser); // a different address
    expect(await attempt(await elsewhere.newPage(), lockee.email, lockee.password)).toBeNull();
    await here.close();
    await elsewhere.close();
  });

  test('the session cookie is private to /admin, and signing out really ends it', async ({
    browser,
  }) => {
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await signIn(page, receptionist);

    const cookie = (await ctx.cookies()).find((c) => c.name.endsWith('salon-staff.session'))!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/admin' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('salon-staff'); // scripts cannot read it
    expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(8 * 3600 + 120); // a shift, not a month

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${STAFF}/login`);
    expect((await ctx.cookies()).some((c) => c.name.endsWith('salon-staff.session'))).toBe(false);
    await page.goto(STAFF);
    await expect(page).toHaveURL(`${STAFF}/login`);
    expect((await api(page, 'GET', '/team')).status).toBe(401);
    await ctx.close();
  });

  test('a deactivated person loses access at once, not when their session would have expired', async ({
    browser,
  }) => {
    const leaver = await createStaff('leaver', 'RECEPTIONIST', 'branch-one');
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await signIn(page, leaver);
    expect((await api(page, 'GET', '/services?branchId=x')).status).not.toBe(401); // working session

    await sql('update "Staff" set active = false where id = $1', [leaver.id]);
    await page.goto(STAFF);
    await expect(page).toHaveURL(`${STAFF}/login`);
    expect((await api(page, 'GET', '/services?branchId=x')).status).toBe(401);
    await ctx.close();

    const again = await newVisitor(browser);
    expect(await attempt(await again.newPage(), leaver.email, leaver.password)).toMatch(
      /not right/,
    ); // and cannot sign in again
    await again.close();
  });

  test('the sign-in form keeps the email after a wrong password, so only the password is retyped', async ({
    browser,
  }) => {
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    expect(await attempt(page, receptionist.email, 'wrong-wrong-wrong')).toMatch(/not right/);
    await expect(page.getByLabel('Email')).toHaveValue(receptionist.email);
    await expect(page.getByLabel('Password')).toHaveValue('');
    await ctx.close();
  });
});

test('the staff app can be installed like an app (manifest, icons, scope)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${STAFF}/login`, { waitUntil: 'load' });
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBe('/admin/manifest.webmanifest');
  const manifest = await (await page.request.get(`http://localhost:3001${href}`)).json();
  expect(manifest).toMatchObject({ start_url: '/admin', scope: '/admin/', display: 'standalone' });
  const sizes = manifest.icons.map(
    (i: { sizes: string; purpose?: string }) =>
      `${i.sizes}${i.purpose === 'maskable' ? ' maskable' : ''}`,
  );
  expect(sizes).toEqual(['192x192', '512x512', '512x512 maskable']);
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(`http://localhost:3001${icon.src}`)).status(), icon.src).toBe(
      200,
    );
  }
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute(
    'href',
    '/admin/icons/apple-touch-icon.png',
  );

  // Chrome's own verdict. A test browser is always "incognito", the one thing it cannot install from.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.enable');
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual(
    [],
  );
  await ctx.close();
});

test.describe('accessibility of every staff screen', () => {
  let bookingId = '';
  let clientId = '';

  test.beforeAll(async ({ request }) => {
    const stylist = await createStaff('a11y-stylist', 'STYLIST', 'branch-one');
    const slot = await freeSlot(request, stylist.id, 2, 4);
    const row = await bookViaApi(request, {
      stylistId: stylist.id,
      startAt: slot.startAt,
      name: 'Accessible Customer',
      phone: testPhone(85),
    });
    bookingId = row.id;
    clientId = row.customerId;
  });

  async function audit(
    browser: Browser,
    viewport: { width: number; height: number },
    label: string,
  ) {
    const ctx = await newVisitor(browser, viewport);
    const page = await ctx.newPage();
    await signIn(page, manager);
    const noScroll = async (where: string) =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `horizontal scroll on ${where}`,
      ).toBeLessThanOrEqual(0);
    const check = async (path: string, ready: () => Promise<void>, name: string) => {
      await page.goto(`${STAFF}${path}`);
      await ready();
      await expectNoAxeViolations(page, `${name} (${label})`);
      if (viewport.width < 500) await noScroll(`${name} (${label})`);
    };

    await check(
      '',
      () => expect(page.getByRole('heading', { name: 'Today' })).toBeVisible(),
      'Today',
    );
    await check(
      '/calendar',
      () => expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible(),
      'Calendar',
    );
    await page.getByRole('radio', { name: 'week' }).check({ force: true });
    await expect(page.getByRole('heading', { name: /Week of/ })).toBeVisible();
    // The audit must see a real booking card, not just an empty week: the booking is a few days ahead,
    // so depending on the day the tests run it can be in next week.
    const card = page.getByRole('link', { name: /Accessible Customer/ });
    const inThisWeek = await card
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true, () => false); // the week's bookings load a moment after its heading
    if (!inThisWeek) await page.getByRole('button', { name: 'Next week' }).click();
    await expect(card).toBeVisible();
    await expectNoAxeViolations(page, `Calendar week (${label})`);
    if (viewport.width < 500) await noScroll(`Calendar week (${label})`);
    await check(
      `/bookings/${bookingId}`,
      () => expect(page.getByRole('heading', { name: 'Accessible Customer' })).toBeVisible(),
      'Booking',
    );
    await check(
      '/new',
      async () => {
        await page.locator('label', { hasText: 'Haircut & Style' }).click();
        await expect(page.getByRole('option', { name: /Any available/ })).toBeAttached();
      },
      'New booking',
    );
    await check(
      '/clients',
      async () => {
        await page.getByRole('searchbox').fill('90000 00085');
        await expect(page.getByRole('link', { name: /Accessible Customer/ })).toBeVisible();
      },
      'Clients',
    );
    await check(
      `/clients/${clientId}`,
      () => expect(page.getByRole('heading', { name: 'Accessible Customer' })).toBeVisible(),
      'Client',
    );
    await check('/team', () => expect(page.getByRole('table')).toBeVisible(), 'Team');
    await check(
      '/change-password',
      () => expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible(),
      'Change password',
    );
    await ctx.close();
  }

  test('on a desktop', async ({ browser }) => {
    await audit(browser, { width: 1280, height: 900 }, 'desktop');
    const ctx = await newVisitor(browser);
    const page = await ctx.newPage();
    await page.goto(`${STAFF}/login`);
    await expectNoAxeViolations(page, 'sign in');
    await ctx.close();
  });

  test('on a phone', async ({ browser }) => {
    await audit(browser, { width: 390, height: 844 }, 'phone');
  });
});
