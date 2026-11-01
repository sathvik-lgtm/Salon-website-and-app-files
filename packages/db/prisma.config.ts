import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DIRECT_URL (non-pooled) is used for migrations; DATABASE_URL (pooled) is used at runtime by the apps.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
});
