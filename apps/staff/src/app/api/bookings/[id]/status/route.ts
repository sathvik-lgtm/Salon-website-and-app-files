import { z } from 'zod';
import { apiActor, json, readBody, refusal } from '../../../../../server/api';
import { changeStatus } from '../../../../../server/data';
import { withDb } from '../../../../../server/runtime';

export const dynamic = 'force-dynamic';

const body = z.object({ to: z.enum(['CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) }).strict();

/** `POST /api/bookings/:id/status` with `{ to }`: check in, complete, cancel or mark no-show. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await apiActor(request, { write: true });
  if ('response' in who) return who.response;
  const parsed = await readBody(request, body);
  if ('response' in parsed) return parsed.response;

  const { id } = await params;
  const result = await withDb((db) => changeStatus(db, who.actor, id, parsed.data.to));
  return result.ok ? json({ status: result.to }) : refusal(result.reason);
}
