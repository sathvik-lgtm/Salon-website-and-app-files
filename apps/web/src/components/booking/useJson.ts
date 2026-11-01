'use client';

import { useEffect, useState } from 'react';

export type JsonState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string };

/**
 * Fetches JSON for `url` (null = do nothing) and reports idle / loading / ready / error.
 * The result is remembered together with the URL it belongs to, so a changed URL shows "loading"
 * straight away without resetting state inside an effect, and a slow old response can never be
 * shown for a newer request.
 */
export function useJson<T>(url: string | null): JsonState<T> {
  const [result, setResult] = useState<{ url: string; data?: T; error?: string } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as T & { error?: string };
        setResult(response.ok ? { url, data: body } : { url, error: body.error ?? 'SERVER_ERROR' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResult({ url, error: 'NETWORK' });
      });
    return () => controller.abort();
  }, [url]);

  if (!url) return { status: 'idle' };
  if (result?.url !== url) return { status: 'loading' };
  return result.error !== undefined
    ? { status: 'error', error: result.error }
    : { status: 'ready', data: result.data as T };
}
