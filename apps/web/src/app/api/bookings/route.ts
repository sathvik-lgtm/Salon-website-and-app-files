import { handleCreateBooking } from '../../../server/booking-api';
import { withApiDeps } from '../../../server/deps';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return withApiDeps((deps) => handleCreateBooking(request, deps));
}
