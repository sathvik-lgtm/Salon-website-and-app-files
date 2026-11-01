/**
 * Copies the website's content from the database into `src/generated/catalog.json` before every
 * build and dev start. The pages read that file, so the deployed Worker carries no database code
 * (Prisma and its drivers add about 2.2 MiB to the Worker bundle) and needs no database at runtime.
 *
 * Runs on the build machine only. Needs DATABASE_URL (apps/web/.env.local locally; CI sets it).
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '@salon/db';
import { parseBranchHours } from '@salon/db/hours';
import type { Snapshot } from '../src/lib/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env.local'), quiet: true });
config({ path: resolve(root, '.env'), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. The website copies its content from the database at build time: copy apps/web/.env.example to apps/web/.env.local, start Postgres (docker compose up -d) and run pnpm db:migrate && pnpm db:seed.',
  );
  process.exit(1);
}

const db = createDb(url, 'pg');

try {
  // Creation order, so branches appear in the order the owner set them up (there is no sort column yet).
  const branchRows = await db.branch.findMany({
    where: { active: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const branches = branchRows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    city: b.city,
    address: b.address,
    phone: b.phone,
    timezone: b.timezone,
    hours: parseBranchHours(b.hours),
    mapUrl: b.mapUrl,
    latitude: b.latitude,
    longitude: b.longitude,
    imageUrl: b.imageUrl,
  }));
  const slugById = new Map(branches.map((b) => [b.id, b.slug]));

  const categoryRows = await db.serviceCategory.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      services: {
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        // A service is offered at a branch only if a row exists with available = true.
        include: { branches: { where: { available: true } } },
      },
    },
  });
  const catalog: Snapshot['catalog'] = [];
  for (const c of categoryRows) {
    const services: Snapshot['catalog'][number]['services'] = [];
    for (const s of c.services) {
      const offers: Record<string, { pricePaise: number; durationMin: number }> = {};
      for (const bs of s.branches) {
        const slug = slugById.get(bs.branchId);
        if (!slug) continue; // branch is inactive
        offers[slug] = {
          pricePaise: bs.pricePaise ?? s.basePricePaise,
          durationMin: bs.durationMin ?? s.baseDurationMin,
        };
      }
      if (Object.keys(offers).length === 0) continue;
      services.push({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        featured: s.featured,
        offers,
      });
    }
    if (services.length > 0) catalog.push({ slug: c.slug, name: c.name, services });
  }

  const [promotionRows, membershipRows] = await Promise.all([
    db.promotion.findMany({
      where: { active: true },
      include: { branch: { select: { slug: true, name: true, active: true } } },
      orderBy: { endsAt: 'asc' },
    }),
    db.membershipPlan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    branches,
    catalog,
    promotions: promotionRows
      .filter((p) => !p.branch || p.branch.active)
      .map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        branch: p.branch ? { slug: p.branch.slug, name: p.branch.name } : null,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
        imageUrl: p.imageUrl,
      })),
    memberships: membershipRows.map((m) => ({
      id: m.id,
      name: m.name,
      pricePaise: m.pricePaise,
      period: m.period,
      perks: m.perks,
    })),
  };

  const out = resolve(root, 'src/generated/catalog.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(
    `snapshot: ${branches.length} branches, ${catalog.length} categories, ${catalog.reduce((n, c) => n + c.services.length, 0)} services, ${snapshot.promotions.length} promotions, ${snapshot.memberships.length} plans`,
  );
} finally {
  await db.$disconnect();
}
