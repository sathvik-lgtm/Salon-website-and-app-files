import { apiActor, json, refusal } from '../../../../server/api';
import { getAppointment } from '../../../../server/data';
import { withDb } from '../../../../server/runtime';

export const dynamic = 'force-dynamic';

/** `GET /api/bookings/:id`. An appointment the person may not see looks exactly like a missing one. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await apiActor(request);
  if ('response' in who) return who.response;
  const { id } = await params;
  const result = await withDb((db) => getAppointment(db, who.actor, id));
  return result.ok ? json({ appointment: result.appointment }) : refusal(result.reason);
}
