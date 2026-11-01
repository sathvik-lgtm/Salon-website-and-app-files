import clsx from 'clsx';
import Link from 'next/link';
import type { ScheduleAppointment } from '../../server/data';
import { clockTime } from '../../lib/dates';
import { SOURCE_LABEL } from '../../lib/format';
import { STATUS_LABEL, STATUS_STYLE } from '../../lib/status';

/** The words a screen reader hears for one booking, so colour is never the only signal. */
export function appointmentLabel(a: ScheduleAppointment, timezone: string): string {
  return `${clockTime(a.startAt, timezone)} to ${clockTime(a.endAt, timezone)}, ${a.customerName}, ${a.services.join(', ')}, with ${a.staffName}, ${STATUS_LABEL[a.status] ?? a.status}`;
}

/** One booking as a card, used in the list and week views. Links to its details. */
export function AppointmentCard({
  appointment: a,
  timezone,
  fresh,
  showStylist = true,
}: {
  appointment: ScheduleAppointment;
  timezone: string;
  /** Arrived since the last refresh: ring it for a few seconds. */
  fresh: boolean;
  showStylist?: boolean;
}) {
  return (
    <Link
      href={`/bookings/${a.id}`}
      // No aria-label: everything is already visible text (time, status, name, services, stylist), and a
      // label that words it differently fails WCAG "label in name" (a screen reader user and a sighted user
      // would otherwise get different words).
      className={clsx(
        'block rounded-lg p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        STATUS_STYLE[a.status],
        fresh && 'just-arrived',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">
          {clockTime(a.startAt, timezone)} – {clockTime(a.endAt, timezone)}
        </span>
        <span className="text-xs font-medium">{STATUS_LABEL[a.status] ?? a.status}</span>
      </span>
      <span className="mt-1 block font-medium">{a.customerName}</span>
      <span className="block">{a.services.join(', ')}</span>
      <span className="mt-1 block text-xs opacity-90">
        {showStylist && <>{a.staffName} · </>}
        {SOURCE_LABEL[a.source] ?? a.source}
        {fresh && <strong> · New</strong>}
      </span>
    </Link>
  );
}
