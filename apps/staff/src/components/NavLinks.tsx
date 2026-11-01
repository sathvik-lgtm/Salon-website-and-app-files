'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
}

/** The main links, marking the current section for screen readers and for sight. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname(); // without the /admin prefix
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item) => {
        const current = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={clsx(
                'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium',
                current ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-accent-soft',
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
