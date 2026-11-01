import { z } from 'zod';
import { apiActor, apiError, json, queryOf, refusal } from '../../../server/api';
import { getStylistChoices } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

const query = z.object({
  branchId: z.string().min(1).max(64),
  serviceIds: z.string().min(1).max(600),
});

/** `GET /api/stylists?branchId&serviceIds=a,b`: who can do ALL the chosen services. */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const parsed = query.safeParse(queryOf(request));
  if (!parsed.success) return apiError('INVALID_INPUT', 400);
  const serviceIds = parsed.data.serviceIds.split(',').filter(Boolean);

  const result = await withDb((db) =>
    getStylistChoices(db, who.actor, { branchId: parsed.data.branchId, serviceIds }),
  );
  return result.ok ? json({ stylists: result.stylists }) : refusal(result.reason);
}
