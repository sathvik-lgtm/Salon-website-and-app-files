import type { Metadata } from 'next';
import { ConfirmationView } from '../../../components/booking/ConfirmationView';

// Personal to the visitor's tab, so never indexed.
export const metadata: Metadata = {
  title: 'Booking confirmed',
  robots: { index: false, follow: false },
};

export default function ConfirmationPage() {
  return <ConfirmationView />;
}
