import { apiActor, json, refusal } from '../../../../server/api';
import { getClient } from '../../../../server/data';
import { withDb } from '../../../../server/runtime';

export const dynamic = 'force-dynamic';

/** `GET /api/clients/:id`: one customer with the visits the person may see. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const { id } = await params;
  const result = await withDb((db) => getClient(db, who.actor, id));
  return result.ok ? json({ client: result.client }) : refusal(result.reason);
}
