import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClasses } from '@salon/ui';
import { ImageSlot } from '../../../components/ImageSlot';
import { JsonLd } from '../../../components/JsonLd';
import { OpenNow } from '../../../components/OpenNow';
import { PageIntro } from '../../../components/PageIntro';
import { getBranch, getBranches, getCatalog } from '../../../lib/catalog';
import {
  formatDuration,
  formatPhone,
  formatPrice,
  fullAddress,
  telHref,
} from '../../../lib/format';
import { hoursRows } from '../../../lib/hours';
import { branchJsonLd } from '../../../lib/jsonld';
import { pageMetadata } from '../../../lib/seo';
import type { BranchView } from '../../../lib/types';

// Only the branches that exist at build time are served; any other slug is a plain 404.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getBranches()).map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const branch = await getBranch((await params).slug);
  if (!branch) return {};
  return pageMetadata({
    title: `${branch.name}, ${branch.city}`,
    description: `Visit ${branch.name} at ${branch.address}. Opening hours, phone number, services and prices, and online booking.`,
    path: `/branches/${branch.slug}`,
  });
}

/** Where "Directions" goes: the branch's own map link, else its coordinates, else a search for the address. */
function mapLink(b: BranchView): string {
  if (b.mapUrl) return b.mapUrl;
  const query =
    b.latitude !== null && b.longitude !== null
      ? `${b.latitude},${b.longitude}`
      : encodeURIComponent(`${b.address}, ${b.city}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export default async function BranchPage({ params }: { params: Promise<{ slug: string }> }) {
  const branch = await getBranch((await params).slug);
  if (!branch) notFound();

  const categories = (await getCatalog())
    .map((c) => ({ ...c, services: c.services.filter((s) => s.offers[branch.slug]) }))
    .filter((c) => c.services.length > 0);

  return (
    <>
      <JsonLd data={branchJsonLd(branch)} />
      <PageIntro
        title={branch.name}
        eyebrow={
          <Link href="/branches" className="underline underline-offset-4">
            ← All branches
          </Link>
        }
      >
        {branch.address}
      </PageIntro>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1fr_22rem]">
        <div>
          <ImageSlot
            src={branch.imageUrl}
            alt={`The ${branch.name} salon`}
            ratio="aspect-[16/9]"
            sizes="(min-width: 1024px) 60vw, 100vw"
            priority
          />

          <h2 className="mt-12 font-display text-3xl tracking-tight">Services and prices</h2>
          {categories.length === 0 ? (
            <p className="mt-4 text-muted">
              No services are listed for this branch yet. Please call us.
            </p>
          ) : (
            categories.map((category) => (
              <section key={category.slug} className="mt-8">
                <h3 className="font-display text-xl">{category.name}</h3>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {category.services.map((s) => {
                    const offer = s.offers[branch.slug]!;
                    return (
                      <li key={s.id} className="flex items-start justify-between gap-6 py-3">
                        <div>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-sm text-muted">{formatDuration(offer.durationMin)}</p>
                        </div>
                        <p className="whitespace-nowrap font-medium">
                          {formatPrice(offer.pricePaise)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <aside aria-label={`${branch.name} details`} className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-card border border-line bg-surface p-5">
            <OpenNow hours={branch.hours} timezone={branch.timezone} />

            <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide">Opening hours</h2>
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">Opening hours for {branch.name}</caption>
              <tbody>
                {hoursRows(branch.hours).map((row) => (
                  <tr key={row.day} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal text-muted">
                      {row.day}
                    </th>
                    <td className="py-2 text-right">{row.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide">Find us</h2>
            <p className="mt-2 text-sm">{fullAddress(branch.address, branch.city)}</p>
            <a
              href={mapLink(branch)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4"
            >
              Get directions<span className="sr-only"> (opens in a new tab)</span>
            </a>

            <div className="mt-4 grid gap-3">
              <Link href={`/book?branch=${branch.slug}`} className={buttonClasses()}>
                Book at this branch
              </Link>
              <a href={telHref(branch.phone)} className={buttonClasses({ variant: 'secondary' })}>
                <span className="sr-only">Call {branch.name}: </span>
                {formatPhone(branch.phone)}
              </a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
