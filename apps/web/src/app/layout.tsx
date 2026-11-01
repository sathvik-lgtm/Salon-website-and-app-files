import type { Metadata, Viewport } from 'next';
import { brand } from '@salon/config/brand';
import { SiteFooter } from '../components/SiteFooter';
import { SiteHeader } from '../components/SiteHeader';
import { StickyBookBar } from '../components/StickyBookBar';
import { getBranches } from '../lib/catalog';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
  title: { default: `${brand.name} · Hair, skin & beauty`, template: `%s | ${brand.name}` },
  description: brand.tagline,
  openGraph: { siteName: brand.name, type: 'website', locale: 'en_IN' },
};

export const viewport: Viewport = { themeColor: '#fbfaf8' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branches = await getBranches();
  return (
    <html lang="en-IN">
      <body>
        <a
          href="#main"
          className="sr-only rounded-full bg-ink px-4 py-2 text-sm text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <SiteHeader />
        {/* Extra bottom space on phones so the sticky bar never covers the end of a page. */}
        <main id="main" tabIndex={-1} className="pb-24 outline-none md:pb-0">
          {children}
        </main>
        <SiteFooter branches={branches} />
        <StickyBookBar />
      </body>
    </html>
  );
}
