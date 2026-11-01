import Link from 'next/link';
import { brand } from '@salon/config/brand';
import { formatPhone, telHref } from '../lib/format';
import type { BranchView } from '../lib/types';

const linkClass =
  'inline-flex min-h-11 items-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

// Name above number, so a phone number never breaks across two lines.
const branchLinkClass =
  'flex min-h-11 flex-col justify-center py-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function SiteFooter({ branches }: { branches: BranchView[] }) {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-3">
        <div>
          <p className="font-display text-xl">{brand.name}</p>
          <p className="mt-2 max-w-xs text-sm text-muted">{brand.tagline}</p>
        </div>

        <nav aria-label="Branches">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Call a branch</h2>
          <ul className="mt-3">
            {branches.map((b) => (
              <li key={b.id}>
                <a href={telHref(b.phone)} className={branchLinkClass}>
                  <span>{b.name}</span>
                  <span className="whitespace-nowrap text-ink">{formatPhone(b.phone)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Site">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Explore</h2>
          <ul className="mt-3">
            {[
              ['/services', 'Services'],
              ['/branches', 'Branches'],
              ['/offers', 'Offers & Memberships'],
              ['/privacy', 'Privacy Policy'],
              ['/terms', 'Terms of Service'],
              ['/privacy#data-deletion', 'Request data deletion'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href!} className={linkClass}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        © {new Date().getFullYear()} {brand.name}. Placeholder site content.
      </p>
    </footer>
  );
}
