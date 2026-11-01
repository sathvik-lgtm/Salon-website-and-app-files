import Link from 'next/link';
import { buttonClasses } from '@salon/ui';
import { BranchCard } from '../components/BranchCard';
import { ImageSlot } from '../components/ImageSlot';
import { getBranches, getCatalog, hasPriceRange, lowestPrice } from '../lib/catalog';
import { formatPrice } from '../lib/format';
import { pageMetadata } from '../lib/seo';

export const metadata = pageMetadata({
  title: 'Book hair, skin and beauty appointments',
  description:
    'Book your appointment online in minutes at any of our three branches. Choose your stylist or let us find the first free one.',
  path: '/',
});

export default async function Home() {
  const [branches, catalog] = await Promise.all([getBranches(), getCatalog()]);
  const featured = catalog
    .flatMap((c) => c.services.filter((s) => s.featured).map((s) => ({ ...s, category: c })))
    .slice(0, 6);

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-8 pt-10 md:grid-cols-2 md:pt-16">
        <div className="fade-in">
          <p className="text-sm font-medium text-accent">
            {branches.length} branches · Hair, skin &amp; beauty
          </p>
          <h1 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Look forward to your appointment.
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Book online in a couple of minutes and get an instant confirmation. Pick your stylist,
            or let us find the first one who is free.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book" className={buttonClasses()}>
              Book appointment
            </Link>
            <Link href="/offers" className={buttonClasses({ variant: 'secondary' })}>
              Offers &amp; Memberships
            </Link>
          </div>
        </div>
        <ImageSlot
          alt="Inside the salon"
          ratio="aspect-[4/3] md:aspect-[4/5]"
          sizes="(min-width: 768px) 50vw, 100vw"
          priority
        />
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="featured" className="mx-auto mt-20 max-w-6xl px-4">
          <div className="flex items-end justify-between gap-4">
            <h2 id="featured" className="font-display text-3xl tracking-tight">
              Popular services
            </h2>
            <Link
              href="/services"
              className="text-sm font-medium text-accent underline underline-offset-4"
            >
              View all services
            </Link>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((s) => (
              <li key={s.id} className="relative rounded-card border border-line bg-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {s.category.name}
                </p>
                <h3 className="mt-2 font-display text-xl">
                  <Link
                    href={`/services/${s.category.slug}`}
                    className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                  >
                    {s.name}
                  </Link>
                </h3>
                <p className="mt-3 text-sm text-muted">
                  {hasPriceRange(s) ? 'From ' : ''}
                  <span className="font-medium text-ink">{formatPrice(lowestPrice(s))}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="branches" className="mx-auto mt-20 max-w-6xl px-4">
        <div className="flex items-end justify-between gap-4">
          <h2 id="branches" className="font-display text-3xl tracking-tight">
            Our branches
          </h2>
          <Link
            href="/branches"
            className="text-sm font-medium text-accent underline underline-offset-4"
          >
            All branches
          </Link>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {branches.map((b) => (
            <BranchCard key={b.id} branch={b} />
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="rounded-card bg-accent-soft px-6 py-12 text-center">
          <h2 className="font-display text-3xl tracking-tight">Ready when you are</h2>
          <p className="mx-auto mt-3 max-w-md text-muted">
            Choose a branch, a service and a time. We will confirm it straight away.
          </p>
          <Link href="/book" className={buttonClasses({ className: 'mt-6' })}>
            Book appointment
          </Link>
        </div>
      </section>
    </>
  );
}
