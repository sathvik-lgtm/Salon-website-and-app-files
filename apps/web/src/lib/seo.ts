import type { Metadata } from 'next';
import { brand } from '@salon/config/brand';

export const absoluteUrl = (path: string) => new URL(path, brand.siteUrl).toString();

/** Title, description, canonical URL and Open Graph for one page (`metadataBase` is set in the root layout). */
export function pageMetadata({
  title,
  description,
  path,
}: {
  /** Without the brand name: the root layout's title template appends it. */
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} | ${brand.name}`,
      description,
      url: path,
      siteName: brand.name,
      type: 'website',
      locale: 'en_IN',
    },
  };
}
