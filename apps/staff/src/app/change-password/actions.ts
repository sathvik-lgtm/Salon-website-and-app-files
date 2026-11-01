'use server';

import { hashId } from '@salon/security/rate-limit';
import { redirect } from 'next/navigation';
import { changeOwnPassword } from '../../server/data';
import { getLimiter, log, withDb } from '../../server/runtime';
import { getCurrentActor } from '../../server/session';

export interface ChangePasswordState {
  error: string | null;
}

// Someone with a stolen session could try to guess the current password here: allow 5 wrong
// guesses per person per 15 minutes.
const LIMIT = { limit: 5, windowSec: 15 * 60 };

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const found = await getCurrentActor();
  if (!found) redirect('/login');

  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (!current || !next) return { error: 'Please fill in every field.' };
  if (next !== confirm) return { error: 'The two new passwords do not match.' };

  const limiter = getLimiter();
  const key = await hashId(found.actor.id);
  if (!(await limiter.peek('pw-change', key, LIMIT.limit, LIMIT.windowSec)).allowed) {
    log('password_change_locked');
    return { error: 'Too many attempts. Please wait 15 minutes and try again.' };
  }

  const result = await withDb((db) => changeOwnPassword(db, found.actor, { current, next }));
  if (!result.ok) {
    if (result.reason === 'WRONG_PASSWORD') {
      await limiter.hit('pw-change', key, LIMIT.limit, LIMIT.windowSec);
      return { error: 'The current password is not right.' };
    }
    return { error: result.message ?? 'Please choose a stronger password.' };
  }
  log('password_changed');
  redirect('/');
}
