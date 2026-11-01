'use client';

import { useSyncExternalStore } from 'react';

// One shared ticker. On the server (and for the first client render) the value is null, so the page
// the server sends and the first client render match; the real time arrives right after.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverNow = (): number | null => null;

/** The current time (to the minute), refreshed every 30 seconds; null until the browser has it. */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, currentMinute, serverNow);
}
