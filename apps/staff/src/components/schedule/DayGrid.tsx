import clsx from 'clsx';
import Link from 'next/link';
import type { Schedule, ScheduleAppointment } from '../../server/data';
import { clockTime, formatMinutes, minutesIntoDay, openWindow } from '../../lib/dates';
import { STATUS_LABEL, STATUS_STYLE } from '../../lib/status';
import { appointmentLabel } from './AppointmentCard';

/** Pixels per minute: 84 px an hour is roomy enough to read a 30-minute booking. */
const PX_PER_MIN = 1.4;
const MIN_BLOCK_PX = 30;

/**
 * One day as a time grid with a column per stylist. The time axis follows the branch's opening hours
 * (widened to fit any booking outside them), and today shows a "now" line.
 */
export function DayGrid({
  schedule,
  date,
  now,
  freshIds,
}: {
  schedule: Schedule;
  /** The `YYYY-MM-DD` being shown, in the branch timezone. */
  date: string;
  /** Current time, or null before the browser has it. */
  now: number | null;
  freshIds: Set<string>;
}) {
  const tz = schedule.branch.timezone;
  const open = openWindow(schedule.branch.hours, date);
  const spans = schedule.appointments.map((a) => ({
    start: minutesIntoDay(a.startAt, tz),
    end: minutesIntoDay(a.endAt, tz) || 24 * 60,
  }));
  const first = Math.min(open?.open ?? 9 * 60, ...spans.map((s) => s.start));
  const last = Math.max(open?.close ?? 18 * 60, ...spans.map((s) => s.end));
  const axisStart = Math.floor(first / 60) * 60;
  const axisEnd = Math.ceil(last / 60) * 60;
  const height = (axisEnd - axisStart) * PX_PER_MIN;
  const hours = Array.from(
    { length: (axisEnd - axisStart) / 60 + 1 },
    (_, i) => axisStart + i * 60,
  );

  const nowMin = now === null ? null : minutesIntoDay(new Date(now), tz);
  const showNow =
    now !== null &&
    nowMin !== null &&
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now)) === date &&
    nowMin >= axisStart &&
    nowMin <= axisEnd;

  if (schedule.stylists.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface p-6">
        No stylists to show for this branch.
      </p>
    );
  }

  const byStylist = (id: string) => schedule.appointments.filter((a) => a.staffId === id);

  return (
    <div
      className="relative overflow-x-auto rounded-card border border-line bg-surface"
      role="region"
      aria-label="Day schedule"
      tabIndex={0}
    >
      <div className="flex" style={{ minWidth: 72 + schedule.stylists.length * 180 }}>
        <div className="sticky left-0 z-20 w-[4.5rem] shrink-0 border-r border-line bg-surface">
          <div className="h-11 border-b border-line" />
          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <span
                key={m}
                className={clsx(
                  'absolute right-1 whitespace-nowrap text-xs text-muted',
                  m !== axisStart && '-translate-y-1/2',
                )}
                style={{ top: (m - axisStart) * PX_PER_MIN }}
              >
                {formatMinutes(m)}
              </span>
            ))}
          </div>
        </div>

        <div className="relative flex flex-1">
          {schedule.stylists.map((stylist) => (
            <div
              key={stylist.id}
              className="min-w-[180px] flex-1 border-r border-line last:border-r-0"
            >
              <h2 className="flex h-11 items-center justify-center border-b border-line px-2 text-sm font-semibold">
                {stylist.name}
              </h2>
              <ul className="relative" style={{ height }}>
                {hours.map((m) => (
                  <li
                    key={m}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-line"
                    style={{ top: (m - axisStart) * PX_PER_MIN }}
                  />
                ))}
                {byStylist(stylist.id).map((a) => (
                  <Block
                    key={a.id}
                    appointment={a}
                    timezone={tz}
                    axisStart={axisStart}
                    fresh={freshIds.has(a.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
          {showNow && nowMin !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: 44 + (nowMin - axisStart) * PX_PER_MIN }}
            >
              <span className="rounded bg-red-700 px-1 text-[10px] font-bold text-white">
                {clockTime(new Date(now!), tz)}
              </span>
              <span className="h-0.5 flex-1 bg-red-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({
  appointment: a,
  timezone,
  axisStart,
  fresh,
}: {
  appointment: ScheduleAppointment;
  timezone: string;
  axisStart: number;
  fresh: boolean;
}) {
  const start = minutesIntoDay(a.startAt, timezone);
  const end = minutesIntoDay(a.endAt, timezone) || 24 * 60;
  const top = (start - axisStart) * PX_PER_MIN;
  const blockHeight = Math.max((end - start) * PX_PER_MIN, MIN_BLOCK_PX);
  return (
    <li className="absolute inset-x-1 z-[1]" style={{ top, height: blockHeight }}>
      <Link
        href={`/bookings/${a.id}`}
        aria-label={appointmentLabel(a, timezone)}
        className={clsx(
          'block h-full overflow-hidden rounded-md px-2 py-1 text-xs leading-tight focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          STATUS_STYLE[a.status],
          fresh && 'just-arrived',
        )}
      >
        <span className="font-semibold">{clockTime(a.startAt, timezone)}</span>
        {fresh && <strong className="ml-1 rounded bg-accent px-1 text-accent-ink">New</strong>}
        <span className="ml-1 font-medium">{a.customerName}</span>
        {blockHeight >= 48 && <span className="block truncate">{a.services.join(', ')}</span>}
        {blockHeight >= 64 && <span className="block">{STATUS_LABEL[a.status] ?? a.status}</span>}
      </Link>
    </li>
  );
}
