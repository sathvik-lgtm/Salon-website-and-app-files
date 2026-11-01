import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';
export { branchHoursSchema, parseBranchHours, hoursForWeekday } from './hours';
export type { BranchHours } from './hours';

export type DbDriver = 'neon' | 'pg';

/**
 * Create a Prisma client. Use `neon` on Cloudflare Workers (pooled Neon URL), `pg` for local Docker/CI Postgres.
 * Create one client per request on Workers; do not cache across requests.
 */
export function createDb(connectionString: string, driver: DbDriver = 'neon'): PrismaClient {
  const adapter =
    driver === 'neon' ? new PrismaNeon({ connectionString }) : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
