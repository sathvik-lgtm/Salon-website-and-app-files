import { BookingDetail } from '../../../../components/BookingDetail';
import { requireActor } from '../../../../server/session';

export const metadata = { title: 'Booking' };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  const { id } = await params;
  return <BookingDetail id={id} role={actor.role} />;
}
