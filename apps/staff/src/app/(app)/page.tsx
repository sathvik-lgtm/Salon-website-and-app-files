import { ScheduleView } from '../../components/schedule/ScheduleView';
import { listBranches } from '../../server/data';
import { withDb } from '../../server/runtime';
import { requireActor } from '../../server/session';

export const metadata = { title: 'Today' };

export default async function TodayPage() {
  const { actor } = await requireActor();
  const branches = await withDb((db) => listBranches(db, actor));
  return (
    <ScheduleView
      mode="today"
      branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))}
      defaultBranchId={actor.homeBranchId}
    />
  );
}
