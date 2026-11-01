import type { Metadata, Viewport } from 'next';
import { brand } from '@salon/config/brand';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${brand.name} Staff`, template: `%s | ${brand.name} Staff` },
  robots: { index: false, follow: false },
  description: 'Staff bookings and schedule.',
  // iOS home-screen icon (the manifest covers Android and desktop).
  icons: { apple: '/admin/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#9f3b4f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a
          href="#main"
          className="sr-only rounded-full bg-ink px-4 py-2 text-sm text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
