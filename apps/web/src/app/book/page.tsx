import { BookingFlow } from '../../components/booking/BookingFlow';
import { PageIntro } from '../../components/PageIntro';
import { getBranches, getCatalog } from '../../lib/catalog';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Book an appointment',
  description:
    'Book your appointment online in a couple of minutes: choose a branch, services, stylist and time, and get an instant confirmation.',
  path: '/book',
});

export default async function BookPage() {
  const [branches, catalog] = await Promise.all([getBranches(), getCatalog()]);
  return (
    <>
      <PageIntro title="Book an appointment">
        Five quick steps. Your booking is confirmed straight away.
      </PageIntro>
      <BookingFlow
        branches={branches}
        catalog={catalog}
        // Public by design (it is the widget's site key), read at build time.
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
    </>
  );
}
