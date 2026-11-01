import { LegalPage } from '../../components/LegalPage';
import { getBranches } from '../../lib/catalog';
import { formatPhone, telHref } from '../../lib/format';
import { pageMetadata } from '../../lib/seo';

export const metadata = pageMetadata({
  title: 'Privacy Policy',
  description:
    'What personal information we collect when you book, why, and how to ask us to delete it.',
  path: '/privacy',
});

export default async function PrivacyPage() {
  const branches = await getBranches();
  return (
    <LegalPage title="Privacy Policy" updated="[date]">
      <p>
        This policy explains what personal information [Salon legal name] (&ldquo;we&rdquo;)
        collects when you use this website and book an appointment, and the choices you have. We
        handle this information in line with India&rsquo;s Digital Personal Data Protection Act,
        2023 (DPDP Act).
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your name and mobile phone number, which you give us when you book.</li>
        <li>
          Your booking details: the branch, services, stylist, date and time, and your visit history
          with us.
        </li>
        <li>
          One small cookie that remembers the branch you last chose on the services page, so we can
          suggest it when you book. It holds no personal information.
        </li>
      </ul>

      <h2>Why we collect it</h2>
      <p>
        To make and manage your appointment, to contact you about it if something changes, and to
        keep a record of your visits so our team can serve you better. [We do not sell your
        information: owner to confirm.]
      </p>

      <h2>Who can see it</h2>
      <p>
        Our staff at the branch you book with, and the service providers that host this website and
        our booking system [list providers]. We share it with others only where the law requires.
      </p>

      <h2>How long we keep it</h2>
      <p>
        [Retention period, for example: booking records are kept for X months after your last
        visit.]
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us what information we hold about you, ask us to correct it, or ask us to delete
        it. You can also withdraw your consent at any time. To raise a concern, contact [grievance
        officer name and contact].
      </p>

      <h2 id="data-deletion" className="scroll-mt-24">
        Request data deletion
      </h2>
      <p>
        There is no online form. To have your information deleted, contact the branch you booked
        with by phone, tell them the name and phone number you booked with, and ask them to delete
        your data. We will confirm once it is done, within [number] days. We may keep what the law
        requires us to keep.
      </p>
      <ul>
        {branches.map((b) => (
          <li key={b.id}>
            {b.name}:{' '}
            <a
              href={telHref(b.phone)}
              className="font-medium text-accent underline underline-offset-4"
            >
              {formatPhone(b.phone)}
            </a>
          </li>
        ))}
      </ul>
    </LegalPage>
  );
}
