import { ScheduleView } from '../../../components/schedule/ScheduleView';
import { listBranches } from '../../../server/data';
import { withDb } from '../../../server/runtime';
import { requireActor } from '../../../server/session';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage() {
  const { actor } = await requireActor();
  const branches = await withDb((db) => listBranches(db, actor));
  return (
    <ScheduleView
      mode="calendar"
      branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))}
      defaultBranchId={actor.homeBranchId}
    />
  );
}
