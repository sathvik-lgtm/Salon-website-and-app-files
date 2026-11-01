import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@playwright/test';

// The same settings the apps read locally (DATABASE_URL, Auth.js, Turnstile test keys). CI sets them directly.
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '../web/.env.local', quiet: true });

const env = {
  ...(process.env as Record<string, string>),
  DB_DRIVER: 'pg',
  // Cloudflare's published always-pass test secret: for tests only.
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA',
};

export default defineConfig({
  testDir: './e2e',
  // One at a time: the tests share one database, one set of branches and one rate-limit memory.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    // Locally use the Chrome that is already installed; CI installs Playwright's own Chromium.
    ...(process.env.CI ? {} : { channel: 'chrome' as const }),
  },
  // Both apps are needed: customers book on the website, staff see it in the staff app.
  // Each needs a finished `pnpm build` first. A server that is already running is reused locally.
  webServer: [
    {
      command: 'pnpm --filter @salon/web start',
      cwd: '../..',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env,
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3001/admin/login',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env,
    },
  ],
});
