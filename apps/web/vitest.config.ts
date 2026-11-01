import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit tests only. The browser tests in e2e/ are run by Playwright (`pnpm e2e`), not Vitest.
  test: { include: ['src/**/*.test.ts'] },
});
