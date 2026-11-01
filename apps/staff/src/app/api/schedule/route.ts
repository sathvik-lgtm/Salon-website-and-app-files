import { z } from 'zod';
import { apiActor, apiError, json, queryOf, refusal } from '../../../server/api';
import { getScheduleForDate } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

const query = z.object({
  branchId: z.string().min(1).max(64),
  date: z.string().min(1).max(10),
  view: z.enum(['day', 'week']).default('day'),
  stylistId: z.string().min(1).max(64).optional(),
});

/** `GET /api/schedule?branchId&date=YYYY-MM-DD&view=day|week&stylistId` */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const parsed = query.safeParse(queryOf(request));
  if (!parsed.success) return apiError('INVALID_INPUT', 400);

  const result = await withDb((db) => getScheduleForDate(db, who.actor, parsed.data));
  return result.ok ? json(result) : refusal(result.reason);
}
