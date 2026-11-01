/**
 * PLACEHOLDER seed data only. Nothing here is real business data.
 * Idempotent: safe to re-run. OWNER credentials come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD.
 */
import 'dotenv/config';
import { createDb, Role, type BranchHours } from './index';
import { parseBranchHours } from './hours';
import { hashPassword } from './password';

const rs = (n: number) => n * 100; // rupees -> paise

const std = { open: '10:00', close: '20:00' };
const branches = [
  {
    slug: 'branch-one',
    name: 'Placeholder Salon — Branch One',
    city: 'Placeholder City',
    address: '1 Placeholder Street, Placeholder City 000001',
    phone: '+910000000001',
    hours: { mon: std, tue: std, wed: std, thu: std, fri: std, sat: std, sun: std },
  },
  {
    slug: 'branch-two',
    name: 'Placeholder Salon — Branch Two',
    city: 'Placeholder City',
    address: '2 Placeholder Road, Placeholder City 000002',
    phone: '+910000000002',
    hours: { mon: null, tue: std, wed: std, thu: std, fri: std, sat: std, sun: std },
  },
  {
    slug: 'branch-three',
    name: 'Placeholder Salon — Branch Three',
    city: 'Placeholder City',
    address: '3 Placeholder Avenue, Placeholder City 000003',
    phone: '+910000000003',
    hours: { mon: std, tue: std, wed: std, thu: std, fri: std, sat: std, sun: { open: '11:00', close: '18:00' } },
  },
] satisfies { slug: string; hours: BranchHours; [k: string]: unknown }[];

const categories = [
  { slug: 'hair', name: 'Hair', sortOrder: 1 },
  { slug: 'skin', name: 'Skin & Facials', sortOrder: 2 },
  { slug: 'nails', name: 'Nails', sortOrder: 3 },
  { slug: 'grooming', name: 'Grooming', sortOrder: 4 },
];

const services = [
  { slug: 'haircut', cat: 'hair', name: 'Haircut & Style', price: 600, min: 45, featured: true },
  { slug: 'hair-colour', cat: 'hair', name: 'Global Hair Colour', price: 3500, min: 120, featured: true },
  { slug: 'highlights', cat: 'hair', name: 'Highlights', price: 4500, min: 150 },
  { slug: 'hair-spa', cat: 'hair', name: 'Hair Spa', price: 1500, min: 60, featured: true },
  { slug: 'blow-dry', cat: 'hair', name: 'Blow Dry', price: 500, min: 30 },
  { slug: 'keratin', cat: 'hair', name: 'Keratin Treatment', price: 7000, min: 180 },
  { slug: 'classic-facial', cat: 'skin', name: 'Classic Facial', price: 1200, min: 60, featured: true },
  { slug: 'deep-cleanse', cat: 'skin', name: 'Deep Cleanse Facial', price: 1800, min: 75 },
  { slug: 'clean-up', cat: 'skin', name: 'Clean-up', price: 800, min: 30 },
  { slug: 'manicure', cat: 'nails', name: 'Manicure', price: 700, min: 45 },
  { slug: 'pedicure', cat: 'nails', name: 'Pedicure', price: 900, min: 60 },
  { slug: 'gel-polish', cat: 'nails', name: 'Gel Polish', price: 1000, min: 45 },
  { slug: 'beard-trim', cat: 'grooming', name: 'Beard Trim', price: 300, min: 30 },
  { slug: 'threading', cat: 'grooming', name: 'Eyebrow Threading', price: 100, min: 30 },
  { slug: 'bridal-trial', cat: 'skin', name: 'Bridal Makeup Trial', price: 5000, min: 120, branchOnly: 'branch-one' },
];

// Per-branch overrides (price in rupees and/or duration in minutes).
const overrides: Record<string, Record<string, { price?: number; min?: number }>> = {
  'branch-two': { haircut: { price: 700 }, 'hair-spa': { min: 75 } },
  'branch-three': { haircut: { price: 550 } },
};

const stylistCounts: Record<string, number> = { 'branch-one': 4, 'branch-two': 5, 'branch-three': 4 };

const promotions = [
  { title: 'Placeholder: Weekday Glow', description: 'PLACEHOLDER — 15% off facials Mon–Thu.', branch: null },
  { title: 'Placeholder: New Client Welcome', description: 'PLACEHOLDER — complimentary blow dry with any colour.', branch: 'branch-one' },
  { title: 'Placeholder: Monsoon Hair Spa', description: 'PLACEHOLDER — hair spa at a special price.', branch: 'branch-two' },
];

const memberships = [
  { name: 'Placeholder Silver', price: 1999, period: 'MONTHLY' as const, perks: ['PLACEHOLDER perk: 10% off services', 'PLACEHOLDER perk: priority booking'], sortOrder: 1 },
  { name: 'Placeholder Gold', price: 4999, period: 'QUARTERLY' as const, perks: ['PLACEHOLDER perk: 15% off services', 'PLACEHOLDER perk: free blow dry monthly'], sortOrder: 2 },
  { name: 'Placeholder Platinum', price: 14999, period: 'YEARLY' as const, perks: ['PLACEHOLDER perk: 20% off services', 'PLACEHOLDER perk: birthday treatment'], sortOrder: 3 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!ownerEmail || !ownerPassword) throw new Error('SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD must be set');

  const db = createDb(url, 'pg');

  const branchRows = new Map<string, string>();
  for (const b of branches) {
    const hours = parseBranchHours(b.hours);
    const row = await db.branch.upsert({
      where: { slug: b.slug },
      update: { name: b.name, address: b.address, city: b.city, phone: b.phone, hours },
      create: { slug: b.slug, name: b.name, address: b.address, city: b.city, phone: b.phone, hours },
    });
    branchRows.set(b.slug, row.id);
  }

  const catRows = new Map<string, string>();
  for (const c of categories) {
    const row = await db.serviceCategory.upsert({ where: { slug: c.slug }, update: c, create: c });
    catRows.set(c.slug, row.id);
  }

  const serviceRows = new Map<string, string>();
  for (const [i, s] of services.entries()) {
    const data = {
      categoryId: catRows.get(s.cat)!,
      name: s.name,
      description: 'PLACEHOLDER description.',
      basePricePaise: rs(s.price),
      baseDurationMin: s.min,
      featured: s.featured ?? false,
      sortOrder: i,
    };
    const row = await db.service.upsert({ where: { slug: s.slug }, update: data, create: { slug: s.slug, ...data } });
    serviceRows.set(s.slug, row.id);

    for (const [slug, branchId] of branchRows) {
      if (s.branchOnly && s.branchOnly !== slug) continue;
      const o = overrides[slug]?.[s.slug];
      const bs = { available: true, pricePaise: o?.price ? rs(o.price) : null, durationMin: o?.min ?? null };
      await db.branchService.upsert({
        where: { branchId_serviceId: { branchId, serviceId: row.id } },
        update: bs,
        create: { branchId, serviceId: row.id, ...bs },
      });
    }
  }

  // OWNER (credentials from env)
  const ownerHash = await hashPassword(ownerPassword);
  await db.staff.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: 'Owner',
      role: Role.OWNER,
      homeBranchId: branchRows.get('branch-one')!,
      passwordHash: ownerHash,
    },
  });

  // Placeholder stylists: unusable random passwords (they do not log in to the seed environment).
  const hairSlugs = services.filter((s) => s.cat === 'hair' || s.cat === 'grooming').map((s) => s.slug);
  const skinNailSlugs = services.filter((s) => s.cat === 'skin' || s.cat === 'nails').map((s) => s.slug);
  for (const [slug, count] of Object.entries(stylistCounts)) {
    const branchId = branchRows.get(slug)!;
    const branchOnlyOk = (svc: string) => !services.find((s) => s.slug === svc)?.branchOnly || services.find((s) => s.slug === svc)?.branchOnly === slug;
    for (let n = 1; n <= count; n++) {
      const email = `stylist-${slug}-${n}@example.invalid`;
      const qualified = [...hairSlugs, ...(n % 2 === 0 ? skinNailSlugs : skinNailSlugs.slice(0, 4))].filter(branchOnlyOk);
      const staff = await db.staff.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: `Placeholder Stylist ${n} (${slug})`,
          role: Role.STYLIST,
          homeBranchId: branchId,
          bookable: true,
          passwordHash: await hashPassword(crypto.randomUUID()),
        },
      });
      await db.staffService.deleteMany({ where: { staffId: staff.id } });
      await db.staffService.createMany({
        data: qualified.map((s) => ({ staffId: staff.id, serviceId: serviceRows.get(s)! })),
      });
      // Mon-Sat 10:00-19:00; one weekly day off varies by stylist (never the same for everyone).
      await db.staffSchedule.deleteMany({ where: { staffId: staff.id } });
      const dayOff = (n % 6) + 1;
      await db.staffSchedule.createMany({
        data: [1, 2, 3, 4, 5, 6]
          .filter((d) => d !== dayOff)
          .map((weekday) => ({ staffId: staff.id, weekday, startMinute: 10 * 60, endMinute: 19 * 60 })),
      });
    }
  }

  // Promotions and memberships (placeholder, replaced wholesale on each seed).
  await db.promotion.deleteMany({});
  const now = new Date();
  const inOneYear = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  for (const p of promotions) {
    await db.promotion.create({
      data: {
        title: p.title,
        description: p.description,
        branchId: p.branch ? branchRows.get(p.branch)! : null,
        startsAt: now,
        endsAt: inOneYear,
      },
    });
  }
  await db.membershipPlan.deleteMany({});
  for (const m of memberships) {
    await db.membershipPlan.create({
      data: { name: m.name, pricePaise: rs(m.price), period: m.period, perks: m.perks, sortOrder: m.sortOrder },
    });
  }

  console.log('Seeded placeholder data.');
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
