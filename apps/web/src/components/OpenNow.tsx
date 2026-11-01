'use client';

import clsx from 'clsx';
import { useSyncExternalStore } from 'react';
import type { BranchHours } from '@salon/db/hours';
import { openStatus } from '../lib/hours';

// The page is prerendered, so "open now" is worked out in the browser. One shared ticker (the
// current minute) re-renders it as time passes; the server snapshot is null, so the server HTML and
// the first client render match and nothing flashes.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const serverMinute = () => null;

export function OpenNow({
  hours,
  timezone,
  className,
}: {
  hours: BranchHours;
  timezone: string;
  className?: string;
}) {
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  const status = minute === null ? null : openStatus(hours, timezone, new Date(minute * 60_000));
  return (
    // Reserve the line's height so the page does not jump when the status appears.
    <p className={clsx('flex min-h-6 items-center gap-2 text-sm', className)}>
      {status && (
        <>
          <span
            aria-hidden="true"
            className={clsx('size-2 rounded-full', status.open ? 'bg-emerald-600' : 'bg-stone-400')}
          />
          <span className={status.open ? 'font-medium text-ink' : 'text-muted'}>{status.text}</span>
        </>
      )}
    </p>
  );
}
