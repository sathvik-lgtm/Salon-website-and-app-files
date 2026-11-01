import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit and database tests only. The browser tests in e2e/ are run by Playwright (`pnpm e2e`).
  test: { include: ['src/**/*.test.ts'] },
});
