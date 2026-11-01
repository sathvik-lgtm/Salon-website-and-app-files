import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@playwright/test';

// Same settings the app reads locally (DATABASE_URL, Turnstile test keys). CI sets them directly.
loadEnv({ path: '.env.local', quiet: true });

const PORT = 3000;

export default defineConfig({
  testDir: './e2e',
  // One at a time: the booking tests share one seeded database and one set of stylists.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Locally use the Chrome that is already installed; CI installs Playwright's own Chromium.
    ...(process.env.CI ? {} : { channel: 'chrome' as const }),
  },
  webServer: {
    // Needs a finished `pnpm build` first (CI and `pnpm e2e` after a build). Reuses a running server locally.
    command: 'pnpm start',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...(process.env as Record<string, string>),
      DB_DRIVER: 'pg',
      // Cloudflare's published always-pass test secret: for tests only.
      TURNSTILE_SECRET_KEY:
        process.env.TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA',
    },
  },
});
