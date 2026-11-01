import 'server-only';
import type {
  BranchView,
  CategoryView,
  MembershipView,
  PromotionView,
  ServiceView,
  Snapshot,
} from './types';
// Written by scripts/snapshot.ts (runs before every dev start, build and typecheck). The pages read
// this file instead of the database, so the deployed Worker carries no database code.
import snapshotJson from '../generated/catalog.json';

const snapshot = snapshotJson as unknown as Snapshot;

/** Everything the content pages show was copied from the database when the site was built. */
export async function getBranches(): Promise<BranchView[]> {
  return snapshot.branches;
}

export async function getBranch(slug: string): Promise<BranchView | undefined> {
  return snapshot.branches.find((b) => b.slug === slug);
}

/** Active categories with their active services, each with the price and duration per offering branch. */
export async function getCatalog(): Promise<CategoryView[]> {
  return snapshot.catalog;
}

/** Promotions within their date range right now (at build time, for prerendered pages), plus membership plans. */
export async function getOffers(): Promise<{
  promotions: PromotionView[];
  memberships: MembershipView[];
}> {
  const now = Date.now();
  return {
    promotions: snapshot.promotions
      .filter((p) => Date.parse(p.startsAt) <= now && Date.parse(p.endsAt) >= now)
      .map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        branch: p.branch,
        endsAt: p.endsAt,
        imageUrl: p.imageUrl,
      })),
    memberships: snapshot.memberships,
  };
}

/** The cheapest price across the branches that offer the service. */
export function lowestPrice(service: ServiceView): number {
  return Math.min(...Object.values(service.offers).map((o) => o.pricePaise));
}

export function hasPriceRange(service: ServiceView): boolean {
  return new Set(Object.values(service.offers).map((o) => o.pricePaise)).size > 1;
}
