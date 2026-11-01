import Link from 'next/link';
import { LegalPage } from '../../components/LegalPage';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Terms of Service',
  description: 'The terms that apply when you use this website and book an appointment.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="[date]">
      <p>
        These terms apply when you use this website and book an appointment with [Salon legal name]
        (&ldquo;we&rdquo;). By booking you agree to them.
      </p>

      <h2>Bookings</h2>
      <ul>
        <li>
          An online booking is confirmed straight away when you finish it. There is no approval
          step.
        </li>
        <li>Please give your real name and a phone number we can reach you on.</li>
        <li>
          To limit abuse, we may limit how many upcoming bookings one phone number can hold, and we
          may cancel bookings that look false.
        </li>
      </ul>

      <h2>Changes and cancellations</h2>
      <p>
        To change or cancel a booking, please phone your branch. The number is on your confirmation
        and on our{' '}
        <Link href="/branches" className="font-medium text-accent underline underline-offset-4">
          branches page
        </Link>
        . [Cancellation and late-arrival policy to be added.]
      </p>

      <h2>Prices and payment</h2>
      <p>
        Prices shown are for the service listed and may change. We do not take payments on this
        website. [How and when you pay, and taxes and discounts wording, to be added.]
      </p>

      <h2>Offers and memberships</h2>
      <p>
        The offers and membership plans on this site are for information. Their terms are set by the
        branch. [Details to be added.]
      </p>

      <h2>Liability</h2>
      <p>[Limitation of liability wording to be added by a lawyer.]</p>

      <h2>Privacy</h2>
      <p>
        How we use your information is explained in our{' '}
        <Link href="/privacy" className="font-medium text-accent underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPage>
  );
}
