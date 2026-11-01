import { PageIntro } from '../../components/PageIntro';
import { ServiceMenu } from '../../components/ServiceMenu';
import { getBranches, getCatalog } from '../../lib/catalog';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Services and prices',
  description:
    'Our full menu of hair, skin, nail and grooming services with prices and durations for each branch.',
  path: '/services',
});

export default async function ServicesPage() {
  const [branches, categories] = await Promise.all([getBranches(), getCatalog()]);
  return (
    <>
      <PageIntro title="Services and prices">
        Prices and times can differ a little between branches. Choose yours to see exactly what you
        will pay.
      </PageIntro>
      <div className="mx-auto max-w-3xl px-4">
        <ServiceMenu branches={branches} categories={categories} />
      </div>
    </>
  );
}
