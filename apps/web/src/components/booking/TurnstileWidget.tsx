'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | undefined;

/** Loads Cloudflare's script once per page. */
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined; // allow a retry on the next mount
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Asks for a fresh token. A token works once and expires after 5 minutes, so call this after any failed attempt. */
  reset(): void;
}

/**
 * Cloudflare Turnstile bot check. `onToken` gets the token when the check passes and null when it
 * expires or fails. The token is only proof for the server to verify: it protects nothing by itself.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  onUnavailable,
  ref,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Called if Cloudflare's script cannot be loaded (blocked, offline). */
  onUnavailable: () => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Keep the latest callbacks without re-rendering the widget.
  const callbacks = useRef({ onToken, onUnavailable });
  useEffect(() => {
    callbacks.current = { onToken, onUnavailable };
  });

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      callbacks.current.onToken(null);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => callbacks.current.onToken(token),
          'error-callback': () => callbacks.current.onToken(null),
          'expired-callback': () => callbacks.current.onToken(null),
          'timeout-callback': () => callbacks.current.onToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onUnavailable();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  // Reserve the widget's height so the page does not jump when it appears.
  return <div ref={container} className="min-h-[65px]" />;
}
