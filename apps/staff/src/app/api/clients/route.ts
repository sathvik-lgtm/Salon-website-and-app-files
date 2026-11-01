import { z } from 'zod';
import { apiActor, apiError, json, queryOf, refusal } from '../../../server/api';
import { searchClients } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

/** `GET /api/clients?q=`: customers by part of their phone number (at least 4 digits). */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const parsed = z.object({ q: z.string().max(40) }).safeParse(queryOf(request));
  if (!parsed.success) return apiError('INVALID_INPUT', 400);
  const result = await withDb((db) => searchClients(db, who.actor, parsed.data.q));
  return result.ok
    ? json({ clients: result.clients, tooShort: result.tooShort })
    : refusal(result.reason);
}
