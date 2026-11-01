import { ImageSlot } from '../../components/ImageSlot';
import { PageIntro } from '../../components/PageIntro';
import { getOffers } from '../../lib/catalog';
import { formatDate, formatPeriod, formatPrice } from '../../lib/format';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Offers & Memberships',
  description: 'Current promotions and membership plans at all of our branches.',
  path: '/offers',
});

export default async function OffersPage() {
  const { promotions, memberships } = await getOffers();
  return (
    <>
      <PageIntro title="Offers & Memberships">
        Current promotions and our membership plans. This page is for information only: please ask
        at your branch for details.
      </PageIntro>

      <section aria-labelledby="promotions" className="mx-auto max-w-6xl px-4">
        <h2 id="promotions" className="font-display text-3xl tracking-tight">
          Current offers
        </h2>
        {promotions.length === 0 ? (
          <p className="mt-4 text-muted">
            There are no offers running right now. Please check back soon.
          </p>
        ) : (
          <ul className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {promotions.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-card border border-line bg-surface">
                {p.imageUrl && (
                  <ImageSlot
                    src={p.imageUrl}
                    alt=""
                    ratio="aspect-[16/9]"
                    className="rounded-none"
                  />
                )}
                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-accent">
                    {p.branch ? p.branch.name : 'All branches'}
                  </p>
                  <h3 className="mt-2 font-display text-xl">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted">{p.description}</p>
                  <p className="mt-4 text-sm">Offer ends {formatDate(p.endsAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="memberships" className="mx-auto mt-20 max-w-6xl px-4">
        <h2 id="memberships" className="font-display text-3xl tracking-tight">
          Membership plans
        </h2>
        {memberships.length === 0 ? (
          <p className="mt-4 text-muted">Membership plans are coming soon.</p>
        ) : (
          <ul className="mt-6 grid gap-6 md:grid-cols-3">
            {memberships.map((m) => (
              <li
                key={m.id}
                className="flex flex-col rounded-card border border-line bg-surface p-6"
              >
                <h3 className="font-display text-2xl">{m.name}</h3>
                <p className="mt-3">
                  <span className="text-3xl font-semibold">{formatPrice(m.pricePaise)}</span>
                  <span className="text-muted"> / {formatPeriod(m.period)}</span>
                </p>
                <ul className="mt-5 space-y-2 text-sm">
                  {m.perks.map((perk) => (
                    <li key={perk} className="flex gap-2">
                      <span aria-hidden="true" className="text-accent">
                        ✓
                      </span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
