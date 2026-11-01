import { redirect } from 'next/navigation';
import { ClientDetail } from '../../../../components/ClientDetail';
import { canSearchClients } from '../../../../server/access';
import { listBranches } from '../../../../server/data';
import { withDb } from '../../../../server/runtime';
import { requireActor } from '../../../../server/session';

export const metadata = { title: 'Client' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor();
  if (!canSearchClients(actor)) redirect('/');
  const { id } = await params;
  const branches = await withDb((db) => listBranches(db, actor));
  return <ClientDetail id={id} timezone={branches[0]?.timezone ?? 'Asia/Kolkata'} />;
}
