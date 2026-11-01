import { redirect } from 'next/navigation';
import { NewBooking } from '../../../components/NewBooking';
import { listBranches } from '../../../server/data';
import { withDb } from '../../../server/runtime';
import { requireActor } from '../../../server/session';

export const metadata = { title: 'New booking' };

export default async function NewBookingPage() {
  const { actor } = await requireActor();
  if (actor.role === 'STYLIST') redirect('/'); // stylists cannot book (the API refuses them too)
  const branches = await withDb((db) => listBranches(db, actor));
  return (
    <NewBooking
      branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))}
      defaultBranchId={actor.homeBranchId}
    />
  );
}
