'use client';

import { buttonClasses } from '@salon/ui';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import type { ClientDetail as ClientData } from '../server/data';
import { ApiError, errorText, getJson } from '../lib/api-client';
import { dateAndTime } from '../lib/dates';
import { SOURCE_LABEL, formatPhone, formatPrice, telHref } from '../lib/format';
import { STATUS_LABEL, STATUS_BADGE } from '../lib/status';

/** One customer and their visits (only the ones this person is allowed to see). */
export function ClientDetail({ id, timezone }: { id: string; timezone: string }) {
  const query = useQuery({
    queryKey: ['client', id],
    queryFn: ({ signal }) => getJson<{ client: ClientData }>(`/admin/api/clients/${id}`, signal),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  });

  if (query.isPending) return <p className="text-muted">Loading the client…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-2xl">Client not found</h1>
        <p className="mt-2 text-muted">{errorText(query.error)}</p>
        <Link href="/clients" className={buttonClasses({ className: 'mt-4' })}>
          Back to search
        </Link>
      </div>
    );
  }

  const c = query.data.client;
  return (
    <div className="max-w-3xl">
      <Link
        href="/clients"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        ← Back to search
      </Link>
      <h1 className="mt-2 font-display text-3xl">{c.name}</h1>
      <p className="mt-1">
        <a href={telHref(c.phone)} className="font-medium text-accent underline underline-offset-4">
          {formatPhone(c.phone)}
        </a>
      </p>

      <h2 className="mt-8 font-display text-xl">Visits</h2>
      {c.history.length === 0 ? (
        <p className="mt-2 text-muted">No visits to show.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface">
          {c.history.map((h) => (
            <li key={h.id}>
              <Link
                href={`/bookings/${h.id}`}
                className="block px-4 py-3 hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{dateAndTime(h.startAt, timezone)}</span>
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      STATUS_BADGE[h.status],
                    )}
                  >
                    {STATUS_LABEL[h.status] ?? h.status}
                  </span>
                </span>
                <span className="block text-sm">{h.services.join(', ')}</span>
                <span className="block text-sm text-muted">
                  {h.staffName} · {h.branchName} · {SOURCE_LABEL[h.source] ?? h.source} ·{' '}
                  {formatPrice(h.totalPricePaise)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
