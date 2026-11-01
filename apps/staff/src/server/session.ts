import 'server-only';
import { auth } from '../auth';
import { redirect } from 'next/navigation';
import { loadActor } from './data';
import { withDb } from './runtime';

/**
 * The signed-in person, as the DATABASE says they are right now. The session cookie only says who
 * they are; role, branch and "still active" are re-read on every request, so deactivating or
 * demoting someone takes effect immediately.
 */
export async function getCurrentActor() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return withDb((db) => loadActor(db, id));
}

/**
 * For pages: the signed-in person, or a redirect to sign in. Someone who still has a temporary
 * password is sent to choose their own first (only the change-password page opts out of that).
 */
export async function requireActor({ allowPasswordChange = false } = {}) {
  const found = await getCurrentActor();
  if (!found) redirect('/login');
  if (found.mustChangePassword && !allowPasswordChange) redirect('/change-password');
  return found;
}
