'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonClasses } from '@salon/ui';
import { NavLinks, type NavItem } from './NavLinks';

/** Phone navigation: a disclosure button and a panel with the links and both call-to-action buttons. */
export function MobileMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          // The name stays "Menu"; aria-expanded tells assistive tech whether it is open.
          open ? 'border-ink bg-ink text-bg' : 'border-line bg-surface',
        )}
      >
        Menu
        <span className="sr-only"> navigation</span>
      </button>
      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full border-b border-line bg-bg px-4 pb-6 pt-2 shadow-sm"
        >
          <nav aria-label="Mobile">
            <NavLinks
              items={items}
              onNavigate={close}
              className="divide-y divide-line"
              linkClassName="flex min-h-12 items-center text-lg"
            />
          </nav>
          <div className="mt-4 grid gap-3">
            <Link href="/book" onClick={close} className={buttonClasses()}>
              Book appointment
            </Link>
            <Link
              href="/offers"
              onClick={close}
              className={buttonClasses({ variant: 'secondary' })}
            >
              Offers &amp; Memberships
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
