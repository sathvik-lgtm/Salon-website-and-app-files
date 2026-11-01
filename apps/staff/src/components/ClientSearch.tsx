'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClientSummary } from '../server/data';
import { errorText, getJson } from '../lib/api-client';
import { longDate, localDate } from '../lib/dates';
import { formatPhone } from '../lib/format';

/** Finds customers by part of their phone number. Waits for a pause in typing before searching. */
export function ClientSearch({ timezone }: { timezone: string }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const digits = query.replace(/\D/g, '');
  const result = useQuery({
    queryKey: ['clients', query],
    enabled: digits.length >= 4,
    queryFn: ({ signal }) =>
      getJson<{ clients: ClientSummary[]; tooShort: boolean }>(
        `/admin/api/clients?q=${encodeURIComponent(query)}`,
        signal,
      ),
  });

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl">Clients</h1>
      <label htmlFor="phone-search" className="mt-6 block font-medium">
        Find by phone number
      </label>
      <input
        id="phone-search"
        type="search"
        inputMode="tel"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby="phone-search-hint"
        className="mt-1 block min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <p id="phone-search-hint" className="mt-1 text-sm text-muted">
        Type at least 4 digits of the number, any part of it.
      </p>

      <div className="mt-6" aria-live="polite">
        {digits.length < 4 && text.trim() !== '' && (
          <p className="text-muted">Keep typing: at least 4 digits.</p>
        )}
        {digits.length >= 4 && result.isPending && <p className="text-muted">Searching…</p>}
        {result.isError && (
          <p role="alert" className="text-red-900">
            {errorText(result.error)}
          </p>
        )}
        {result.isSuccess && result.data.clients.length === 0 && (
          <p>No clients found for that number.</p>
        )}
        {result.isSuccess && result.data.clients.length > 0 && (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {result.data.clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                >
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-sm text-muted">{formatPhone(c.phone)}</span>
                  </span>
                  <span className="text-right text-sm text-muted">
                    {c.visits} {c.visits === 1 ? 'visit' : 'visits'}
                    {c.lastVisit && (
                      <> · last {longDate(localDate(new Date(c.lastVisit), timezone))}</>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
