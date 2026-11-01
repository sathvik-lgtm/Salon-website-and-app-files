import { hashId } from '@salon/security/rate-limit';
import { apiActor, apiError, json, refusal } from '../../../../../server/api';
import { setTemporaryPassword } from '../../../../../server/data';
import { getLimiter, withDb } from '../../../../../server/runtime';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/team/:id/temporary-password`. The new password is in the response ONCE, for the person
 * resetting to read out; it is never stored or logged in clear.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await apiActor(request, { write: true });
  if ('response' in who) return who.response;

  // Resetting is rare: 20 an hour per person is plenty and stops a stolen session from churning through accounts.
  const limit = await getLimiter().hit('pw-reset', await hashId(who.actor.id), 20, 3600);
  if (!limit.allowed) return apiError('RATE_LIMITED', 429);

  const { id } = await params;
  const result = await withDb((db) => setTemporaryPassword(db, who.actor, id));
  return result.ok ? json({ password: result.password }) : refusal(result.reason);
}
