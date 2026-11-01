import { BranchCard } from '../../components/BranchCard';
import { PageIntro } from '../../components/PageIntro';
import { getBranches } from '../../lib/catalog';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Our branches',
  description: 'Find your nearest branch: address, opening hours and phone number.',
  path: '/branches',
});

export default async function BranchesPage() {
  const branches = await getBranches();
  return (
    <>
      <PageIntro title="Our branches">
        Visit whichever branch is closest. Each has its own team, opening hours and prices.
      </PageIntro>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
        {branches.map((b) => (
          <BranchCard key={b.id} branch={b} headingLevel={2} />
        ))}
      </div>
    </>
  );
}
