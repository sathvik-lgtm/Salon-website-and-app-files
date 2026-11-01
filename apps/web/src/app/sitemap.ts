import type { MetadataRoute } from 'next';
import { getBranches, getCatalog } from '../lib/catalog';
import { absoluteUrl } from '../lib/seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [branches, catalog] = await Promise.all([getBranches(), getCatalog()]);
  const paths = [
    '/',
    '/branches',
    ...branches.map((b) => `/branches/${b.slug}`),
    '/services',
    ...catalog.map((c) => `/services/${c.slug}`),
    '/offers',
    '/privacy',
    '/terms',
  ];
  const lastModified = new Date();
  return paths.map((path) => ({ url: absoluteUrl(path), lastModified }));
}
