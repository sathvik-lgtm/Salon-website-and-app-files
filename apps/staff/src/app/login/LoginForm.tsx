'use client';

import { buttonClasses } from '@salon/ui';
import { TurnstileWidget, type TurnstileHandle } from '@salon/ui/turnstile';
import { useActionState, useRef, useState } from 'react';
import { loginAction, type LoginState } from './actions';

const input =
  'mt-1 block min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function LoginForm({ siteKey }: { siteKey: string | undefined }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {
    error: null,
  });
  // Held in state: React clears uncontrolled fields after a form action, and a person who mistyped
  // their password should only have to retype the password.
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [captchaDown, setCaptchaDown] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  return (
    <form
      action={async (formData) => {
        formAction(formData);
        // A bot-check token works once, so ask for a fresh one after every attempt.
        turnstile.current?.reset();
      }}
      className="space-y-5"
    >
      {state.error && (
        <p
          role="alert"
          className="rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="email" className="font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
        />
      </div>
      <div>
        <label htmlFor="password" className="font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>
      <input type="hidden" name="turnstileToken" value={token ?? ''} />

      {siteKey && !captchaDown ? (
        <TurnstileWidget
          ref={turnstile}
          siteKey={siteKey}
          onToken={setToken}
          onUnavailable={() => setCaptchaDown(true)}
        />
      ) : (
        <p
          role="alert"
          className="rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          The security check could not load. Please reload the page.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !token}
        aria-busy={pending}
        className={buttonClasses({
          className: 'w-full disabled:cursor-not-allowed disabled:opacity-60',
        })}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {!token && siteKey && !captchaDown && (
        <p className="text-center text-sm text-muted">Waiting for the security check…</p>
      )}
    </form>
  );
}
