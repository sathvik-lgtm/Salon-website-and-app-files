'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonClasses } from '@salon/ui';

/** Phone-only bar pinned to the bottom with both buttons. Hidden on the booking page itself. */
export function StickyBookBar() {
  const pathname = usePathname();
  if (pathname.startsWith('/book')) return null;
  return (
    <nav
      aria-label="Quick actions"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
        <Link
          href="/offers"
          className={buttonClasses({
            variant: 'secondary',
            className: 'px-3 text-center leading-tight',
          })}
        >
          Offers &amp; Memberships
        </Link>
        <Link href="/book" className={buttonClasses({ className: 'px-3' })}>
          Book appointment
        </Link>
      </div>
    </nav>
  );
}
