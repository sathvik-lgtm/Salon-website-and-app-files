'use client';

import { buttonClasses } from '@salon/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import {
  allowedTransitions,
  type AppointmentStatus,
  type Role,
  type TargetStatus,
} from '../server/access';
import type { AppointmentDetail } from '../server/data';
import { ApiError, errorText, getJson, postJson } from '../lib/api-client';
import { clockTime, dateAndTime } from '../lib/dates';
import { SOURCE_LABEL, formatDuration, formatPhone, formatPrice, telHref } from '../lib/format';
import { ACTION_LABEL, NEEDS_CONFIRMATION, STATUS_LABEL, STATUS_BADGE } from '../lib/status';

const ACTION_DONE: Record<TargetStatus, string> = {
  CHECKED_IN: 'Checked in.',
  COMPLETED: 'Marked complete.',
  CANCELLED: 'Booking cancelled. The time is free again.',
  NO_SHOW: 'Marked as a no-show. The time is free again.',
};

/** One booking: the details, the buttons that make sense for its status, and who changed what. */
export function BookingDetail({ id, role }: { id: string; role: Role }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: ({ signal }) =>
      getJson<{ appointment: AppointmentDetail }>(`/admin/api/bookings/${id}`, signal),
    refetchInterval: 20_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  });
  const [confirming, setConfirming] = useState<TargetStatus | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (to: TargetStatus) =>
      postJson<{ status: string }>(`/admin/api/bookings/${id}/status`, { to }),
    onSuccess: (_result, to) => {
      setConfirming(null);
      setDone(ACTION_DONE[to]);
    },
    onError: () => {
      // Someone else may have changed it first: show what it is now.
      setConfirming(null);
      setDone(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking', id] });
      void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  if (query.isPending) return <p className="text-muted">Loading the booking…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-2xl">
          {query.error instanceof ApiError && query.error.code === 'NOT_FOUND'
            ? 'Booking not found'
            : 'Could not load the booking'}
        </h1>
        <p className="mt-2 text-muted">{errorText(query.error)}</p>
        <Link href="/" className={buttonClasses({ className: 'mt-4' })}>
          Back to today
        </Link>
      </div>
    );
  }

  const a = query.data.appointment;
  const tz = a.branch.timezone;
  const actions = role === 'STYLIST' ? [] : allowedTransitions(a.status as AppointmentStatus);

  return (
    <div className="max-w-3xl">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        ← Back to the schedule
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl">{a.customerName}</h1>
        <span
          className={clsx('rounded-full px-3 py-1 text-sm font-medium', STATUS_BADGE[a.status])}
        >
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
      </div>

      <dl className="mt-6 rounded-card border border-line bg-surface p-5 text-sm">
        <Row term="When" detail={`${dateAndTime(a.startAt, tz)} to ${clockTime(a.endAt, tz)}`} />
        <Row
          term="Stylist"
          detail={
            a.stylistPreference === 'ANY_AVAILABLE'
              ? `${a.staffName} (any available was chosen)`
              : a.staffName
          }
        />
        <Row term="Branch" detail={a.branch.name} />
        {a.customerPhone && (
          <Row
            term="Phone"
            detail={
              <a
                href={telHref(a.customerPhone)}
                className="font-medium text-accent underline underline-offset-4"
              >
                {formatPhone(a.customerPhone)}
              </a>
            }
          />
        )}
        <Row
          term="Booked"
          detail={`${SOURCE_LABEL[a.source] ?? a.source}, ${dateAndTime(a.createdAt, tz)}`}
        />
        <div className="border-b border-line py-3">
          <dt className="text-muted">Services</dt>
          <dd>
            <ul className="mt-2 space-y-1">
              {a.items.map((item, i) => (
                <li key={`${item.serviceName}-${i}`} className="flex justify-between gap-4">
                  <span>
                    {item.serviceName}
                    <span className="text-muted"> · {formatDuration(item.durationMin)}</span>
                  </span>
                  <span className="font-medium">{formatPrice(item.pricePaise)}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <Row
          term="Total"
          detail={`${formatPrice(a.totalPricePaise)} · ${formatDuration(a.totalDurationMin)}`}
        />
      </dl>

      <p role="status" className="mt-4 min-h-6 font-medium">
        {done}
      </p>
      {change.isError && (
        <p
          role="alert"
          className="mt-2 rounded-card border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {errorText(change.error)}
        </p>
      )}

      {role === 'STYLIST' ? (
        <p className="mt-2 text-sm text-muted">
          Your schedule is read-only. Please ask the front desk to change a booking.
        </p>
      ) : actions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          This booking is finished, so it cannot be changed.
        </p>
      ) : confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="confirm-title"
          className="mt-2 rounded-card border border-red-700 bg-red-50 p-4"
        >
          <p id="confirm-title" className="font-medium">
            {confirming === 'CANCELLED'
              ? 'Cancel this booking?'
              : 'Mark this customer as a no-show?'}
          </p>
          <p className="mt-1 text-sm">
            This cannot be undone. The time becomes free for someone else.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              autoFocus
              disabled={change.isPending}
              onClick={() => change.mutate(confirming)}
              className="min-h-11 rounded-full bg-red-800 px-6 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
            >
              {confirming === 'CANCELLED' ? 'Yes, cancel it' : 'Yes, mark no-show'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className={buttonClasses({ variant: 'secondary' })}
            >
              No, keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-3">
          {actions.map((to) => (
            <button
              key={to}
              type="button"
              disabled={change.isPending}
              onClick={() =>
                NEEDS_CONFIRMATION.includes(to) ? setConfirming(to) : change.mutate(to)
              }
              className={buttonClasses({
                variant: to === 'CHECKED_IN' || to === 'COMPLETED' ? 'primary' : 'secondary',
                className: 'disabled:opacity-60',
              })}
            >
              {ACTION_LABEL[to]}
            </button>
          ))}
        </div>
      )}

      {a.audit.length > 0 && (
        <section aria-labelledby="history" className="mt-10">
          <h2 id="history" className="font-display text-xl">
            History
          </h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {a.audit.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="py-2">
                <span className="font-medium">{describe(entry)}</span> by {entry.actorName}
                <span className="text-muted"> · {dateAndTime(entry.at, tz)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function describe(entry: { action: string; detail: unknown }): string {
  const detail = (entry.detail ?? {}) as { from?: string; to?: string; source?: string };
  if (entry.action === 'STATUS_CHANGE') {
    return `${STATUS_LABEL[detail.from ?? ''] ?? detail.from} → ${STATUS_LABEL[detail.to ?? ''] ?? detail.to}`;
  }
  if (entry.action === 'CREATE_BOOKING')
    return `Booked at the desk (${SOURCE_LABEL[detail.source ?? ''] ?? 'desk'})`;
  return entry.action;
}

function Row({ term, detail }: { term: string; detail: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-line py-3 last:border-0">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right font-medium">{detail}</dd>
    </div>
  );
}
