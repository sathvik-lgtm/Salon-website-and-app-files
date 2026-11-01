'use client';

import { buttonClasses } from '@salon/ui';
import { useActionState } from 'react';
import { changePasswordAction, type ChangePasswordState } from './actions';

const input =
  'mt-1 block min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    { error: null },
  );
  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p
          role="alert"
          className="rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="current" className="font-medium">
          {forced ? 'Temporary password' : 'Current password'}
        </label>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>
      <div>
        <label htmlFor="next" className="font-medium">
          New password
        </label>
        <input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="next-hint"
          className={input}
        />
        <p id="next-hint" className="mt-1 text-sm text-muted">
          At least 10 characters. A few words together is easy to remember and hard to guess.
        </p>
      </div>
      <div>
        <label htmlFor="confirm" className="font-medium">
          New password again
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={input}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={buttonClasses({ className: 'w-full disabled:opacity-60' })}
      >
        {pending ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
