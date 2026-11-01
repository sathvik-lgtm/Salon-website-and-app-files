import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageIntro } from '../../../components/PageIntro';
import { ServiceMenu } from '../../../components/ServiceMenu';
import { getBranches, getCatalog } from '../../../lib/catalog';
import { pageMetadata } from '../../../lib/seo';

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getCatalog()).map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const slug = (await params).category;
  const category = (await getCatalog()).find((c) => c.slug === slug);
  if (!category) return {};
  return pageMetadata({
    title: `${category.name} services and prices`,
    description: `${category.name} services with prices and durations for each branch.`,
    path: `/services/${category.slug}`,
  });
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const slug = (await params).category;
  const [branches, catalog] = await Promise.all([getBranches(), getCatalog()]);
  const category = catalog.find((c) => c.slug === slug);
  if (!category) notFound();

  return (
    <>
      <PageIntro
        title={category.name}
        eyebrow={
          <Link href="/services" className="underline underline-offset-4">
            ← All services
          </Link>
        }
      >
        Choose your branch to see its prices and times.
      </PageIntro>
      <div className="mx-auto max-w-3xl px-4">
        <ServiceMenu branches={branches} categories={[category]} showCategoryTitles={false} />

        <nav aria-label="Other categories" className="mt-12 border-t border-line pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide">More services</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {catalog
              .filter((c) => c.slug !== category.slug)
              .map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/services/${c.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium hover:bg-bg"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
