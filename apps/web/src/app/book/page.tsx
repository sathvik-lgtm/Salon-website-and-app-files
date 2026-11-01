import type { Metadata } from 'next';
import { PageIntro } from '../../components/PageIntro';
import { getBranches } from '../../lib/catalog';
import { formatPhone, telHref } from '../../lib/format';

// Placeholder until the booking flow is built (M4). Kept out of search results meanwhile.
export const metadata: Metadata = {
  title: 'Book an appointment',
  robots: { index: false },
};

export default async function BookPage() {
  const branches = await getBranches();
  return (
    <>
      <PageIntro title="Book an appointment">
        Online booking is opening soon. Until then, please call the branch you would like to visit.
      </PageIntro>
      <ul className="mx-auto max-w-6xl space-y-3 px-4">
        {branches.map((b) => (
          <li key={b.id} className="max-w-md rounded-card border border-line bg-surface p-4">
            <p className="font-medium">{b.name}</p>
            <a
              href={telHref(b.phone)}
              className="inline-flex min-h-11 items-center font-medium text-accent underline underline-offset-4"
            >
              <span className="sr-only">Call {b.name}: </span>
              {formatPhone(b.phone)}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
