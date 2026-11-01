import Link from 'next/link';
import { brand } from '@salon/config/brand';
import { buttonClasses } from '@salon/ui';
import { MobileMenu } from './MobileMenu';
import { NavLinks, type NavItem } from './NavLinks';

export const NAV_ITEMS: NavItem[] = [
  { href: '/services', label: 'Services' },
  { href: '/branches', label: 'Branches' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="font-display text-xl tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          {brand.name}
        </Link>

        <nav aria-label="Main" className="hidden md:block">
          <NavLinks
            items={NAV_ITEMS}
            className="flex items-center gap-8"
            linkClassName="inline-flex min-h-11 items-center text-sm font-medium hover:text-accent"
          />
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/offers" className={buttonClasses({ variant: 'secondary' })}>
            Offers &amp; Memberships
          </Link>
          <Link href="/book" className={buttonClasses()}>
            Book appointment
          </Link>
        </div>

        <MobileMenu items={NAV_ITEMS} />
      </div>
    </header>
  );
}
