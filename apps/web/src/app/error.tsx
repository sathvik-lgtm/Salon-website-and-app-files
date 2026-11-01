'use client';

import Link from 'next/link';
import { buttonClasses } from '@salon/ui';

/** Friendly failure screen. Never shows error details to a customer. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-16">
      <h1 className="font-display text-4xl tracking-tight">Something went wrong</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Sorry about that. Please try again, or call your branch and we will help you straight away.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={buttonClasses()}>
          Try again
        </button>
        <Link href="/branches" className={buttonClasses({ variant: 'secondary' })}>
          Branch phone numbers
        </Link>
      </div>
    </div>
  );
}
