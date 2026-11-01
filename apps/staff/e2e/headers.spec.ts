import { expect, test, type Page } from '@playwright/test';
import { STAFF } from './helpers';

/** The staff app's headers: the website's set, plus never indexed and never cached. */

// (A bare redirect such as /admin to /admin/login has no content, so it is not checked.)
const PATHS = ['/login', '/change-password', '/api/schedule'];

function watchPolicyViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  return violations;
}

test.describe('security headers', () => {
  for (const path of PATHS) {
    test(`/admin${path} carries the full set`, async ({ request }) => {
      const response = await request.get(`${STAFF}${path}`, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['strict-transport-security']).toContain('max-age=31536000');
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['cache-control']).toContain('no-store');
      expect(headers['x-robots-tag']).toContain('noindex');
    });
  }

  test('only the sign-in page may reach Turnstile', async ({ request }) => {
    const login = (await request.get(`${STAFF}/login`)).headers()['content-security-policy'] ?? '';
    const other = (await request.get(`${STAFF}/api/schedule`)).headers()['content-security-policy'] ?? '';
    expect(other).toContain("default-src 'self'");
    expect(login).toContain('https://challenges.cloudflare.com');
    expect(other).not.toContain('https://challenges.cloudflare.com');
  });

  test('the sign-in page works under the policy, including the Turnstile widget', async ({ page }) => {
    const violations = watchPolicyViolations(page);
    await page.goto(`${STAFF}/login`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(() => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com')), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 30_000 });
    expect(violations).toEqual([]);
  });
});
