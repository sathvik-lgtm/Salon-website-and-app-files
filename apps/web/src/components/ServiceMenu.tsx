'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { buttonClasses } from '@salon/ui';
import { branchCookieString, readBranchCookie } from '../lib/branch-cookie';
import { formatDuration, formatPrice } from '../lib/format';
import type { BranchView, CategoryView } from '../lib/types';

// The chosen branch lives in a cookie (so the booking flow can use it as its default). This store
// reads it and notifies every menu on the page when it changes. The server snapshot is null, so the
// prerendered HTML shows the first branch and a returning visitor's branch is applied on load.
const EVENT = 'salon-branch-change';
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
};
const readSaved = () => readBranchCookie(document.cookie);
const serverSaved = () => null;

function selectBranch(slug: string) {
  document.cookie = branchCookieString(slug);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The service menu with a branch switcher. Prices and durations follow the chosen branch, and
 * services the branch does not offer are hidden. The page is prerendered with every branch's data,
 * so switching is instant and needs no request.
 */
export function ServiceMenu({
  branches,
  categories,
  showCategoryTitles = true,
}: {
  branches: Pick<BranchView, 'slug' | 'name'>[];
  categories: CategoryView[];
  /**
   * Show each category as an h2 (linking to its page) with services as h3. Turn off on a category's
   * own page, where the page title already is the category and services are h2.
   */
  showCategoryTitles?: boolean;
}) {
  const saved = useSyncExternalStore(subscribe, readSaved, serverSaved);
  const selected = branches.find((b) => b.slug === saved) ?? branches[0];
  if (!selected) return null;

  const ServiceHeading = showCategoryTitles ? 'h3' : 'h2';

  const visible = categories
    .map((c) => ({ ...c, services: c.services.filter((s) => s.offers[selected.slug]) }))
    .filter((c) => c.services.length > 0);
  const count = visible.reduce((n, c) => n + c.services.length, 0);

  return (
    <div>
      <fieldset className="rounded-card border border-line bg-surface p-4">
        <legend className="px-2 text-sm font-medium">Show prices for</legend>
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <label key={b.slug} className="cursor-pointer">
              <input
                type="radio"
                name="branch"
                value={b.slug}
                checked={b.slug === selected.slug}
                onChange={() => selectBranch(b.slug)}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium transition-colors hover:bg-bg peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                {b.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p role="status" className="sr-only">
        Showing {count} services at {selected.name}
      </p>

      {visible.length === 0 ? (
        <p className="mt-8 text-muted">
          No services are listed for this branch yet. Please call us.
        </p>
      ) : (
        visible.map((category) => (
          <section key={category.slug} className="mt-10">
            {showCategoryTitles && (
              <h2 className="font-display text-2xl">
                <Link
                  href={`/services/${category.slug}`}
                  className="hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                >
                  {category.name}
                </Link>
              </h2>
            )}
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {category.services.map((service) => {
                const offer = service.offers[selected.slug]!;
                return (
                  <li key={service.id} className="flex items-start justify-between gap-6 py-4">
                    <div>
                      <ServiceHeading className="font-medium">{service.name}</ServiceHeading>
                      {service.description && (
                        <p className="mt-1 text-sm text-muted">{service.description}</p>
                      )}
                      <p className="mt-1 text-sm text-muted">{formatDuration(offer.durationMin)}</p>
                    </div>
                    <p className="whitespace-nowrap font-medium">{formatPrice(offer.pricePaise)}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <div className="mt-10">
        <Link href="/book" className={buttonClasses()}>
          Book at {selected.name}
        </Link>
      </div>
    </div>
  );
}
