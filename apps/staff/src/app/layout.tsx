import type { Metadata } from 'next';
import { brand } from '@salon/config/brand';
import './globals.css';

export const metadata: Metadata = {
  title: `${brand.name} Staff`,
  robots: { index: false, follow: false },
  description: brand.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
