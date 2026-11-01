import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * Connection string for the Postgres integration tests, or null to skip them locally.
 * Reads TEST_DATABASE_URL, then DATABASE_URL (also from packages/db/.env for local dev).
 * In CI a missing database is an error, so the concurrency test can never be skipped silently.
 * Refuses anything that is not localhost: the tests write rows, and must never touch Neon.
 */
export function testDatabaseUrl(): string | null {
  config({ path: fileURLToPath(new URL('../../../db/.env', import.meta.url)), quiet: true });
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    if (process.env.CI) throw new Error('CI must provide DATABASE_URL for the Postgres tests');
    console.warn('No DATABASE_URL: skipping Postgres integration tests.');
    return null;
  }
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`Refusing to run integration tests against non-local database host "${host}"`);
  }
  return url;
}
