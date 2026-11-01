import { redirect } from 'next/navigation';
import { ClientSearch } from '../../../components/ClientSearch';
import { canSearchClients } from '../../../server/access';
import { listBranches } from '../../../server/data';
import { withDb } from '../../../server/runtime';
import { requireActor } from '../../../server/session';

export const metadata = { title: 'Clients' };

export default async function ClientsPage() {
  const { actor } = await requireActor();
  if (!canSearchClients(actor)) redirect('/');
  const branches = await withDb((db) => listBranches(db, actor));
  return <ClientSearch timezone={branches[0]?.timezone ?? 'Asia/Kolkata'} />;
}
