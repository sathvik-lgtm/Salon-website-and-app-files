import type { BranchHours } from '@salon/db/hours';

/** Plain, serialisable shapes the pages render. Copied from the database into a JSON file at build time (scripts/snapshot.ts). */

export interface BranchView {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  /** E.164 */
  phone: string;
  timezone: string;
  hours: BranchHours;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
}

/** What one branch charges for a service, after any branch override. */
export interface ServiceOffer {
  pricePaise: number;
  durationMin: number;
}

export interface ServiceView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  featured: boolean;
  /** Only the branches that offer the service, keyed by branch slug. */
  offers: Record<string, ServiceOffer>;
}

export interface CategoryView {
  slug: string;
  name: string;
  services: ServiceView[];
}

export interface PromotionView {
  id: string;
  title: string;
  description: string;
  /** null = all branches */
  branch: { slug: string; name: string } | null;
  endsAt: string;
  imageUrl: string | null;
}

export interface MembershipView {
  id: string;
  name: string;
  pricePaise: number;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  perks: string[];
}

/** The shape of `src/generated/catalog.json`, written by `scripts/snapshot.ts`. */
export interface Snapshot {
  generatedAt: string;
  branches: BranchView[];
  catalog: CategoryView[];
  promotions: (PromotionView & { startsAt: string })[];
  memberships: MembershipView[];
}
