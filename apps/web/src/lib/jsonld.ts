import type { BranchHours } from '@salon/db/hours';
import { DAY_NAMES } from './hours';
import { absoluteUrl } from './seo';
import type { BranchView } from './types';

const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Days that share the same open/close times are one entry, as schema.org allows several days per spec. */
export function openingHoursSpecification(hours: BranchHours) {
  const groups = new Map<string, { open: string; close: string; days: string[] }>();
  KEYS.forEach((key, i) => {
    const d = hours[key];
    if (!d) return;
    const id = `${d.open}-${d.close}`;
    const group = groups.get(id) ?? { open: d.open, close: d.close, days: [] };
    group.days.push(DAY_NAMES[i]!);
    groups.set(id, group);
  });
  return [...groups.values()].map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.days,
    opens: g.open,
    closes: g.close,
  }));
}

/** schema.org `BeautySalon` (a LocalBusiness) for one branch. */
export function branchJsonLd(branch: BranchView) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    '@id': absoluteUrl(`/branches/${branch.slug}`),
    name: branch.name,
    url: absoluteUrl(`/branches/${branch.slug}`),
    telephone: branch.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: branch.address,
      addressLocality: branch.city,
      addressCountry: 'IN',
    },
    ...(branch.latitude !== null && branch.longitude !== null
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: branch.latitude,
            longitude: branch.longitude,
          },
        }
      : {}),
    ...(branch.imageUrl ? { image: branch.imageUrl } : {}),
    openingHoursSpecification: openingHoursSpecification(branch.hours),
  };
}
