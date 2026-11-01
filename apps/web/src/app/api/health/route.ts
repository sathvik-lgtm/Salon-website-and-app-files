import { handleHealth } from '../../../server/booking-api';
import { withApiDeps } from '../../../server/deps';

// For uptime monitors: never cached, so it reports the site's state right now.
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return withApiDeps((deps) => handleHealth(request, deps));
}
