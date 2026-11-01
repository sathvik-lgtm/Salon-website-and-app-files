import { z } from 'zod';
import { apiActor, apiError, json, queryOf, refusal } from '../../../server/api';
import { listServices } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

/** `GET /api/services?branchId`: what the branch offers, with its own price and time. */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const parsed = z.object({ branchId: z.string().min(1).max(64) }).safeParse(queryOf(request));
  if (!parsed.success) return apiError('INVALID_INPUT', 400);
  const result = await withDb((db) => listServices(db, who.actor, parsed.data.branchId));
  return result.ok ? json({ services: result.services }) : refusal(result.reason);
}
