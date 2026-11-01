import { AppHeader } from '../../components/AppHeader';
import { QueryProvider } from '../../components/QueryProvider';
import { requireActor } from '../../server/session';

/** Everything behind sign-in. Each page and every API call checks the person again; this is not the only lock. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActor();
  return (
    <QueryProvider>
      <AppHeader actor={actor} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none">
        {children}
      </main>
    </QueryProvider>
  );
}
