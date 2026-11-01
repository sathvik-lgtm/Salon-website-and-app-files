import Link from 'next/link';
import { formatPhone, telHref } from '../lib/format';
import type { BranchView } from '../lib/types';
import { ImageSlot } from './ImageSlot';
import { OpenNow } from './OpenNow';

/** `headingLevel` keeps the page outline in order: 2 when the cards sit directly under the h1, 3 under an h2. */
export function BranchCard({
  branch,
  headingLevel = 3,
}: {
  branch: BranchView;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="relative flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <ImageSlot
        src={branch.imageUrl}
        alt={`The ${branch.name} salon`}
        ratio="aspect-[16/10]"
        className="rounded-none"
      />
      <div className="flex flex-1 flex-col p-5">
        <Heading className="font-display text-xl">
          <Link
            href={`/branches/${branch.slug}`}
            className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            {branch.name}
          </Link>
        </Heading>
        <p className="mt-1 text-sm text-muted">{branch.address}</p>
        <OpenNow hours={branch.hours} timezone={branch.timezone} className="mt-3" />
        <p className="mt-auto pt-4">
          <a
            href={telHref(branch.phone)}
            className="relative z-10 inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="sr-only">Call {branch.name}: </span>
            {formatPhone(branch.phone)}
          </a>
        </p>
      </div>
    </article>
  );
}
