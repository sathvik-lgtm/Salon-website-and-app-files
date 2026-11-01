import { z } from 'zod';
import { apiActor, apiError, json, queryOf, refusal } from '../../../server/api';
import { getDeskSlots } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

const query = z.object({
  branchId: z.string().min(1).max(64),
  serviceIds: z.string().min(1).max(600),
  date: z.string().min(1).max(10),
  stylistId: z.string().min(1).max(64).default('ANY'),
});

/** `GET /api/slots?branchId&serviceIds&date&stylistId`: free start times as the front desk sees them. */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const parsed = query.safeParse(queryOf(request));
  if (!parsed.success) return apiError('INVALID_INPUT', 400);
  const { serviceIds, ...rest } = parsed.data;

  const result = await withDb((db) =>
    getDeskSlots(db, who.actor, { ...rest, serviceIds: serviceIds.split(',').filter(Boolean) }),
  );
  if (!result.ok) return refusal(result.reason);
  return json({
    slots: result.slots.map((s) => ({ time: s.time, startAt: s.startAt.toISOString() })),
  });
}
