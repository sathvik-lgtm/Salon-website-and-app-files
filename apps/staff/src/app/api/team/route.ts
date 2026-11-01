import { apiActor, json, refusal } from '../../../server/api';
import { listTeam } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

/** `GET /api/team`: the staff the person may manage (owners: everyone, managers: their branch). */
export async function GET(request: Request) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const result = await withDb((db) => listTeam(db, who.actor));
  return result.ok ? json({ team: result.team }) : refusal(result.reason);
}
