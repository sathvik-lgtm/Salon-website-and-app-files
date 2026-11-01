import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

/**
 * The public website, checked in a real browser at phone and desktop width: accessibility (axe-core,
 * WCAG A/AA + best practice), layout, the branch switcher and cookie, navigation, "open now",
 * structured data, sitemap and links. Motion is reduced so axe measures the page at rest.
 */

const PAGES = [
  '/',
  '/branches',
  '/branches/branch-one',
  '/branches/branch-two',
  '/services',
  '/services/hair',
  '/offers',
  '/privacy',
  '/terms',
  '/book',
  '/book/confirmation',
];

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const;

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`every page on a ${name}`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' } });

    for (const path of PAGES) {
      test(`${path} is accessible, fits the screen and is well formed`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
        page.on('pageerror', (e) => consoleErrors.push(String(e)));

        const response = await page.goto(path, { waitUntil: 'networkidle' });
        expect(response?.status()).toBe(200);
        await expectNoAxeViolations(page, `${path} on a ${name}`);

        const facts = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          h1: document.querySelectorAll('h1').length,
          title: document.title,
          lang: document.documentElement.lang,
          canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') ?? null,
        }));
        expect(facts.overflow, 'horizontal scroll').toBeLessThanOrEqual(0);
        expect(facts.h1, 'number of h1 headings').toBe(1);
        expect(facts.title.length).toBeGreaterThan(3);
        expect(facts.lang).toBe('en-IN');
        if (path !== '/book/confirmation') expect(facts.canonical).toBeTruthy();
        expect(consoleErrors, 'browser console errors').toEqual([]);
      });
    }
  });
}

test.describe('services: branch switcher and cookie', () => {
  test.use({ viewport: VIEWPORTS.phone });

  test('prices follow the branch, the choice is remembered, and arrow keys work', async ({
    page,
    context,
  }) => {
    await page.goto('/services', { waitUntil: 'networkidle' });
    const row = (text: string) => page.locator('li', { hasText: text }).first();

    const names = await page.locator('fieldset label').allInnerTexts();
    expect(names.map((n) => n.replace('Placeholder Salon — ', ''))).toEqual([
      'Branch One',
      'Branch Two',
      'Branch Three',
    ]); // in the order the branches were set up
    await expect(page.getByRole('radio').first()).toBeChecked();
    await expect(row('Haircut & Style')).toContainText('₹600');
    await expect(row('Haircut & Style')).toContainText('45 min');
    await expect(page.getByText('Bridal Makeup Trial')).toHaveCount(1); // a Branch One only service

    await page
      .getByText(/Branch Two/)
      .first()
      .click();
    await expect(row('Haircut & Style')).toContainText('₹700'); // Branch Two override
    await expect(row('Hair Spa')).toContainText('1 hr 15 min'); // Branch Two override
    await expect(page.getByText('Bridal Makeup Trial')).toHaveCount(0);
    await expect(page.getByRole('status').first()).toContainText(
      /Showing \d+ services at .*Branch Two/,
    );

    const cookie = (await context.cookies()).find((c) => c.name === 'salon_branch');
    expect(cookie?.value).toBe('branch-two');
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(300 * 86400); // about a year

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('radio').nth(1)).toBeChecked();
    await expect(row('Haircut & Style')).toContainText('₹700');
    await page.goto('/services/hair', { waitUntil: 'networkidle' });
    await expect(row('Haircut & Style')).toContainText('₹700'); // carried to the category page
    await expect(page.locator('h2', { hasText: 'Haircut & Style' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Book at .*Branch Two/ })).toHaveCount(1);

    await page.goto('/services', { waitUntil: 'networkidle' });
    await page.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio').nth(1)).toBeChecked();
  });
});

test.describe('header, menu and sticky bar', () => {
  test('phone: the menu opens, closes with Escape, and the sticky bar has both buttons', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: VIEWPORTS.phone });
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'networkidle' });

    const menuButton = page.getByRole('button', { name: /menu/i });
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('#mobile-menu');
    await expect(menu.getByRole('link')).toHaveText([
      'Services',
      'Branches',
      'Book appointment',
      'Offers & Memberships',
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-menu')).toHaveCount(0);

    await menuButton.click();
    await menu.getByRole('link', { name: 'Branches' }).click();
    await page.waitForURL('**/branches');
    await expect(page.locator('#mobile-menu')).toHaveCount(0); // closes after choosing a link

    const sticky = page.getByRole('navigation', { name: 'Quick actions' });
    await expect(sticky).toBeVisible();
    await expect(sticky.getByRole('link')).toHaveText(['Offers & Memberships', 'Book appointment']);
    await page.goto('/book', { waitUntil: 'networkidle' });
    await expect(page.getByRole('navigation', { name: 'Quick actions' })).toHaveCount(0); // not on /book
    await context.close();
  });

  test('desktop: both buttons are in the header, and the keyboard can skip to the content', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    await page.goto('/services', { waitUntil: 'networkidle' });
    const header = page.locator('header');
    await expect(header.getByRole('link', { name: 'Offers & Memberships' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Book appointment' })).toBeVisible();
    await expect(page.getByRole('button', { name: /menu/i })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Quick actions' })).toBeHidden();
    await expect(header.locator('nav a[aria-current=page]')).toHaveText('Services');

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await context.close();
  });
});

test.describe('"open now" uses the branch clock, not the visitor clock', () => {
  /** What the page says at a given moment, for a visitor whose own clock is in Los Angeles. */
  async function statusAt(page: Page, iso: string, path: string) {
    await page.clock.install({ time: new Date(iso) });
    await page.goto(path, { waitUntil: 'load' });
    const status = page.locator('p', { has: page.locator('span.rounded-full') }).first();
    await expect(status).toContainText(/Open now|Closed/);
    return (await status.innerText()).trim();
  }

  test.use({ viewport: VIEWPORTS.desktop, timezoneId: 'America/Los_Angeles' });

  test('Monday 11:00 in the branch: open until 8 pm', async ({ page }) => {
    expect(await statusAt(page, '2026-11-09T05:30:00Z', '/branches/branch-one')).toBe(
      'Open now · closes 8:00 pm',
    );
  });

  test('Monday 09:00 in the branch: opens today at 10 am', async ({ page }) => {
    expect(await statusAt(page, '2026-11-09T03:30:00Z', '/branches/branch-one')).toBe(
      'Closed · opens today at 10:00 am',
    );
  });

  test('a branch that is closed on Mondays opens tomorrow', async ({ page }) => {
    expect(await statusAt(page, '2026-11-09T05:30:00Z', '/branches/branch-two')).toBe(
      'Closed · opens tomorrow at 10:00 am',
    );
  });
});

test.describe('search engines, 404s and links', () => {
  test('a branch page has LocalBusiness data, Open Graph tags and a phone link', async ({
    page,
  }) => {
    await page.goto('/branches/branch-three', { waitUntil: 'networkidle' });
    const ld = JSON.parse(
      await page.locator('script[type="application/ld+json"]').first().innerText(),
    );
    expect(ld['@type']).toBe('BeautySalon');
    expect(ld.telephone).toBe('+910000000003');
    expect(ld.address.streetAddress).toBeTruthy();
    expect(ld.openingHoursSpecification).toHaveLength(2);
    expect(
      ld.openingHoursSpecification.some(
        (s: { dayOfWeek: string[]; opens: string; closes: string }) =>
          s.dayOfWeek.includes('Sunday') && s.opens === '11:00' && s.closes === '18:00',
      ),
    ).toBe(true);

    const og = await page.evaluate(() => ({
      title: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      url: document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
      description: document.querySelector('meta[name=description]')?.getAttribute('content'),
    }));
    expect(og.title).toBeTruthy();
    expect(og.url).toMatch(/^https:\/\/example\.com\/branches\/branch-three/);
    expect(og.description).toBeTruthy();
    await expect(page.locator('a[href="tel:+910000000003"]').first()).toBeAttached();
  });

  test('sitemap and robots', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    // home, branches + 3, services + 4, book, offers, privacy, terms
    expect(urls).toHaveLength(14);
    expect(urls).toContain('https://example.com/book');
    expect(urls.some((u) => u!.includes('confirmation'))).toBe(false); // personal, never indexed
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Allow: \//);
    expect(robots).toMatch(/Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  });

  test('unknown pages are a friendly 404', async ({ page, request }) => {
    for (const path of ['/branches/nope', '/services/nope', '/nope']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
    await page.goto('/nope');
    await expect(page.getByRole('heading', { level: 1 })).toContainText("can't find");
    await expect(page.getByRole('link', { name: 'Find a branch' })).toHaveCount(1);
  });

  test('every internal link on every page leads somewhere, and external links are safe', async ({
    page,
    request,
  }) => {
    const seen = new Set<string>();
    const broken: string[] = [];
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'load' });
      const hrefs = await page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => a.getAttribute('href')),
      );
      for (const href of hrefs) {
        if (!href || href.startsWith('#') || /^(tel:|mailto:|https?:)/.test(href)) continue;
        const clean = href.split('#')[0]!.split('?')[0]!;
        if (seen.has(clean)) continue;
        seen.add(clean);
        const status = (await request.get(clean)).status();
        if (status !== 200) broken.push(`${clean} = ${status}`);
      }
      const unsafe = await page.$$eval('a[target=_blank]', (anchors) =>
        anchors
          .filter((a) => !/noopener/.test((a as HTMLAnchorElement).rel))
          .map((a) => a.getAttribute('href')),
      );
      expect(unsafe, `links opening a new tab without rel=noopener on ${path}`).toEqual([]);
    }
    expect(seen.size, 'internal links found').toBeGreaterThanOrEqual(10);
    expect(broken).toEqual([]);
  });
});
