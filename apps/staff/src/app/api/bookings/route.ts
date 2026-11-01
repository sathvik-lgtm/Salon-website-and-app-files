import { z } from 'zod';
import { apiActor, json, readBody, refusal } from '../../../server/api';
import { createDeskBooking } from '../../../server/data';
import { withDb } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

const body = z
  .object({
    branchId: z.string().min(1).max(64),
    serviceIds: z.array(z.string().min(1).max(64)).min(1).max(8),
    startAt: z.iso.datetime({ offset: true }),
    stylistId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(5).max(32),
    source: z.enum(['WALK_IN', 'PHONE']),
  })
  .strict();

/** `POST /api/bookings`: a walk-in or phone booking, through the same engine as the website. */
export async function POST(request: Request) {
  const who = await apiActor(request, { write: true });
  if ('response' in who) return who.response;
  const parsed = await readBody(request, body);
  if ('response' in parsed) return parsed.response;

  const result = await withDb((db) =>
    createDeskBooking(db, who.actor, { ...parsed.data, startAt: new Date(parsed.data.startAt) }),
  );
  if (!result.ok) return refusal(result.reason);
  const a = result.appointment;
  return json(
    {
      appointment: {
        id: a.id,
        staffName: a.staffName,
        startAt: a.startAt.toISOString(),
        endAt: a.endAt.toISOString(),
        totalPricePaise: a.totalPricePaise,
        totalDurationMin: a.totalDurationMin,
        items: a.items,
      },
    },
    201,
  );
}
