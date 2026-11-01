import { expect, test, type Page } from '@playwright/test';
import { fillDetails, pickDateAndTime, pickStylist, startFlow, testPhone } from './helpers';

/** Security headers: present everywhere, and strict enough to matter but loose enough to work. */

const PAGES = ['/', '/services', '/branches', '/offers', '/privacy', '/terms', '/book', '/does-not-exist'];

/** Browser complaints about the policy itself: a blocked script, font, frame or request. */
function watchPolicyViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  return violations;
}

test.describe('security headers', () => {
  for (const path of PAGES) {
    test(`${path} carries the full set`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['strict-transport-security']).toContain('max-age=31536000');
      expect(headers['permissions-policy']).toContain('camera=()');
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
    });
  }

  test('the API responses carry them too', async ({ request }) => {
    const response = await request.get('/api/stylists?serviceId=none');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('the uptime check answers, with and without the database', async ({ request }) => {
    const plain = await request.get('/api/health');
    expect(plain.status()).toBe(200);
    expect(await plain.json()).toEqual({ ok: true });
    const deep = await request.get('/api/health?db=1', { headers: { 'x-forwarded-for': '10.77.0.1' } });
    expect(deep.status()).toBe(200);
    expect(await deep.json()).toEqual({ ok: true, db: true });
  });

  test('only the booking page may reach Turnstile', async ({ request }) => {
    const book = (await request.get('/book')).headers()['content-security-policy'] ?? '';
    const home = (await request.get('/')).headers()['content-security-policy'] ?? '';
    expect(book).toContain('https://challenges.cloudflare.com');
    expect(home).not.toContain('https://challenges.cloudflare.com');
  });

  test('the booking page still works under the policy: fonts, hydration and the Turnstile widget', async ({ page }) => {
    const violations = watchPolicyViolations(page);
    await startFlow(page);
    await pickStylist(page, 'ANY');
    await pickDateAndTime(page, { skipDays: 3 });
    await fillDetails(page, { name: 'Policy Check', phone: testPhone(90) }); // the Turnstile widget is on this step
    // The widget's frame sits in a shadow root, so look at the browser's frames and the token it hands back.
    await expect.poll(() => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com')), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 30_000 });
    expect(violations).toEqual([]);
  });

  test('public pages load without a single policy violation', async ({ page }) => {
    const violations = watchPolicyViolations(page);
    for (const path of ['/', '/services', '/branches', '/offers']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(violations).toEqual([]);
  });
});
