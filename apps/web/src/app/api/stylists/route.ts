import { handleStylists } from '../../../server/booking-api';
import { withApiDeps } from '../../../server/deps';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return withApiDeps((deps) => handleStylists(request, deps));
}
