import { brand } from '@salon/config/brand';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '../auth';
import { canManageTeam, canSearchClients, type Actor } from '../server/access';
import { ROLE_LABEL } from '../lib/format';
import { NavLinks, type NavItem } from './NavLinks';

async function signOutAction() {
  'use server';
  await signOut({ redirect: false });
  redirect('/login');
}

/** Header and navigation. Only the links this person's role allows are shown. */
export function AppHeader({ actor }: { actor: Actor }) {
  const items: NavItem[] = [
    { href: '/', label: 'Today' },
    { href: '/calendar', label: 'Calendar' },
    ...(actor.role !== 'STYLIST' ? [{ href: '/new', label: 'New booking' }] : []),
    ...(canSearchClients(actor) ? [{ href: '/clients', label: 'Clients' }] : []),
    ...(canManageTeam(actor) ? [{ href: '/team', label: 'Team' }] : []),
  ];
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
        <p className="font-display text-lg">
          {brand.name} <span className="text-sm text-muted">Staff</span>
        </p>
        <nav aria-label="Main">
          <NavLinks items={items} />
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <p>
            <span className="font-medium">{actor.name}</span>
            <span className="text-muted"> · {ROLE_LABEL[actor.role]}</span>
          </p>
          <Link
            href="/change-password"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Password
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="min-h-11 rounded-full border border-line px-4 font-medium hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
