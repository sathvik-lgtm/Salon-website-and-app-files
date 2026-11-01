'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { buttonClasses } from '@salon/ui';
import { dateAndTime, localParts } from '../../lib/dates';
import { formatDuration, formatPhone, formatPrice, telHref } from '../../lib/format';
import { buildIcs } from '../../lib/ics';
import {
  bookingReference,
  readReceiptText,
  receiptFromText,
  type BookingReceipt,
} from '../../lib/receipt';
import { PageIntro } from '../PageIntro';

// The booking is kept in this browser tab only (see lib/receipt.ts). While the page loads, the stored
// text is `undefined` (not read yet, so the prerendered page and the first client render match). Once
// read it is the stored text, or `null` when nothing is stored in this tab.
const subscribeNever = () => () => {};
const serverText = (): string | null | undefined => undefined;

function downloadCalendarFile(receipt: BookingReceipt) {
  const reference = bookingReference(receipt.id);
  const ics = buildIcs({
    uid: `${receipt.id}@salon-booking`,
    start: new Date(receipt.startAt),
    end: new Date(receipt.endAt),
    summary: `${receipt.items.map((i) => i.serviceName).join(', ')} at ${receipt.branchName}`,
    location: `${receipt.branchName}, ${receipt.branchAddress}`,
    description: `Stylist: ${receipt.staffName}. Reference: ${reference}. To change or cancel, call ${formatPhone(receipt.branchPhone)}.`,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `appointment-${localParts(receipt.startAt, receipt.timezone).date}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ConfirmationView() {
  const text = useSyncExternalStore<string | null | undefined>(
    subscribeNever,
    readReceiptText,
    serverText,
  );
  // Not read yet: reserve the space and show nothing, so the page does not flash the wrong thing.
  if (text === undefined) return <div className="min-h-[60vh]" aria-hidden="true" />;
  const receipt = receiptFromText(text);
  if (!receipt) return <NoReceipt />;

  return (
    <>
      <PageIntro title="You're booked" eyebrow="Confirmed">
        Thank you. Your appointment is confirmed, and we are looking forward to seeing you.
      </PageIntro>
      <div className="mx-auto max-w-3xl px-4">
        <dl className="rounded-card border border-line bg-surface p-5 text-sm">
          <Row term="When" detail={dateAndTime(receipt.startAt, receipt.timezone)} />
          <Row term="Where" detail={`${receipt.branchName}, ${receipt.branchAddress}`} />
          <Row term="Stylist" detail={receipt.staffName} />
          <Row term="Reference" detail={bookingReference(receipt.id)} />
          <div className="border-b border-line py-3">
            <dt className="text-muted">Services</dt>
            <dd>
              <ul className="mt-2 space-y-1">
                {receipt.items.map((item, i) => (
                  <li key={`${item.serviceName}-${i}`} className="flex justify-between gap-4">
                    <span>
                      {item.serviceName}
                      <span className="text-muted"> · {formatDuration(item.durationMin)}</span>
                    </span>
                    <span className="whitespace-nowrap font-medium">
                      {formatPrice(item.pricePaise)}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <Row
            term="Total"
            detail={`${formatPrice(receipt.totalPricePaise)} · ${formatDuration(receipt.totalDurationMin)}`}
          />
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => downloadCalendarFile(receipt)}
            className={buttonClasses()}
          >
            Add to calendar
          </button>
          <Link href="/" className={buttonClasses({ variant: 'secondary' })}>
            Back to home
          </Link>
        </div>

        <section aria-labelledby="change" className="mt-10 rounded-card bg-accent-soft p-5">
          <h2 id="change" className="font-display text-xl">
            Need to change or cancel?
          </h2>
          <p className="mt-2 text-sm">
            Please phone {receipt.branchName} and quote reference{' '}
            <strong>{bookingReference(receipt.id)}</strong>.
          </p>
          <a
            href={telHref(receipt.branchPhone)}
            className={buttonClasses({ variant: 'secondary', className: 'mt-3' })}
          >
            <span className="sr-only">Call {receipt.branchName}: </span>
            {formatPhone(receipt.branchPhone)}
          </a>
        </section>
      </div>
    </>
  );
}

function NoReceipt() {
  return (
    <>
      <PageIntro title="We can't show your booking here">
        If you have just booked, it is confirmed. This page only shows the booking on the device and
        tab you booked from. To check or change it, please phone your branch.
      </PageIntro>
      <div className="mx-auto flex max-w-3xl flex-wrap gap-3 px-4">
        <Link href="/branches" className={buttonClasses()}>
          Branch phone numbers
        </Link>
        <Link href="/book" className={buttonClasses({ variant: 'secondary' })}>
          Book another appointment
        </Link>
      </div>
    </>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-line py-3 last:border-0">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right font-medium">{detail}</dd>
    </div>
  );
}
