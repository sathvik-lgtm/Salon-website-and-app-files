import { brand } from '@salon/config/brand';
import { redirect } from 'next/navigation';
import { getCurrentActor } from '../../server/session';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  // Already signed in: go straight to the schedule.
  if (await getCurrentActor()) redirect('/');
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-md px-4 py-16 outline-none">
      <p className="font-display text-xl">{brand.name}</p>
      <h1 className="mt-6 font-display text-3xl">Staff sign in</h1>
      <p className="mt-2 text-muted">For the team only. Customers book on the website.</p>
      <div className="mt-8">
        <LoginForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      </div>
    </main>
  );
}
