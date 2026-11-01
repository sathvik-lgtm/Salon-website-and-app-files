import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
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

// Cloudflare Web Analytics: privacy-friendly page-view counts (no cookies, no personal data). Off until
// the owner creates the site in Cloudflare and sets this token at build time (docs/DEPLOYMENT.md).
const analyticsToken = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

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
        {analyticsToken ? (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: analyticsToken })}
          />
        ) : null}
      </body>
    </html>
  );
}
