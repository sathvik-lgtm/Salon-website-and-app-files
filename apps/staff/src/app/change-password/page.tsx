import { requireActor } from '../../server/session';
import { ChangePasswordForm } from './ChangePasswordForm';

export const metadata = { title: 'Change password' };

export default async function ChangePasswordPage() {
  const { mustChangePassword } = await requireActor({ allowPasswordChange: true });
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-md px-4 py-16 outline-none">
      <h1 className="font-display text-3xl">
        {mustChangePassword ? 'Choose your own password' : 'Change your password'}
      </h1>
      <p className="mt-2 text-muted">
        {mustChangePassword
          ? 'You signed in with a temporary password. Please choose your own before you carry on.'
          : 'Enter your current password, then the new one.'}
      </p>
      <div className="mt-8">
        <ChangePasswordForm forced={mustChangePassword} />
      </div>
    </main>
  );
}
