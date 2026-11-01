import { handleAvailability } from '../../../server/booking-api';
import { withApiDeps } from '../../../server/deps';

// Always computed live: availability changes with every booking.
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return withApiDeps((deps) => handleAvailability(request, deps));
}
