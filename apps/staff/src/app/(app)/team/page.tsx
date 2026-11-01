import { redirect } from 'next/navigation';
import { TeamList } from '../../../components/TeamList';
import { canManageTeam } from '../../../server/access';
import { requireActor } from '../../../server/session';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const { actor } = await requireActor();
  if (!canManageTeam(actor)) redirect('/');
  return <TeamList />;
}
