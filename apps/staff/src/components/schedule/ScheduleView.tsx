'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { buttonClasses } from '@salon/ui';
import { useRef, useState } from 'react';
import type { Schedule } from '../../server/data';
import { ApiError, errorText, getJson } from '../../lib/api-client';
import { addDays, clockTime, localDate, longDate, shortDate } from '../../lib/dates';
import { INACTIVE_STATUSES } from '../../lib/status';
import { AppointmentCard } from './AppointmentCard';
import { DayGrid } from './DayGrid';
import { useNow } from './useNow';

export interface BranchOption {
  id: string;
  name: string;
  timezone: string;
}

type ScheduleResponse = Schedule & { range: { startDate: string; days: number }; fresh: string[] };

const POLL_MS = 20_000;
const control =
  'min-h-11 rounded-lg border border-line bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * The schedule screens. `today` is the front desk's home: the branch's own current day, always
 * following the clock. `calendar` adds date navigation and a week view. Both refresh by themselves
 * every ~20 seconds and ring any booking that has appeared since the last refresh.
 */
export function ScheduleView({
  mode,
  branches,
  defaultBranchId,
}: {
  mode: 'today' | 'calendar';
  branches: BranchOption[];
  defaultBranchId: string;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const branch = branches.find((b) => b.id === branchId) ?? branches[0]!;
  const now = useNow();
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [stylistId, setStylistId] = useState('ALL');
  const [showInactive, setShowInactive] = useState(false);

  const today = now === null ? null : localDate(new Date(now), branch.timezone);
  const date = mode === 'today' ? today : (pickedDate ?? today);
  const effectiveView = mode === 'today' ? 'day' : view;

  // What was on screen after the previous refresh, so a booking that is new can be marked.
  const known = useRef<{ key: string; ids: Set<string> } | null>(null);
  const key = `${branchId}|${date}|${effectiveView}`;

  const query = useQuery({
    queryKey: ['schedule', branchId, date, effectiveView],
    enabled: date !== null,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<ScheduleResponse> => {
      const params = new URLSearchParams({ branchId, date: date!, view: effectiveView });
      const data = await getJson<Schedule & { range: ScheduleResponse['range'] }>(
        `/admin/api/schedule?${params}`,
        signal,
      );
      const ids = new Set(data.appointments.map((a) => a.id));
      // New = present now, absent last time, for the SAME branch/day/view (changing day is not "new").
      const fresh =
        known.current?.key === key ? [...ids].filter((id) => !known.current!.ids.has(id)) : [];
      known.current = { key, ids };
      return { ...data, fresh };
    },
  });

  const schedule = query.data;
  const freshIds = new Set(schedule?.fresh ?? []);
  const visible = schedule
    ? schedule.appointments.filter(
        (a) =>
          (stylistId === 'ALL' || a.staffId === stylistId) &&
          (showInactive || !INACTIVE_STATUSES.includes(a.status)),
      )
    : [];
  const columns = schedule
    ? schedule.stylists.filter((s) => stylistId === 'ALL' || s.id === stylistId)
    : [];
  const shown = schedule ? { ...schedule, appointments: visible, stylists: columns } : null;
  const step = effectiveView === 'week' ? 7 : 1;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <h1 className="mr-auto font-display text-3xl">
          {mode === 'today' ? 'Today' : 'Calendar'}
          {date && (
            <span className="block text-base font-normal text-muted">
              {effectiveView === 'week' && schedule
                ? `Week of ${shortDate(schedule.range.startDate)}`
                : longDate(date)}
            </span>
          )}
        </h1>

        {branches.length > 1 ? (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Branch</span>
            <select
              className={control}
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setStylistId('ALL');
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm font-medium">{branch.name}</p>
        )}

        {schedule && schedule.stylists.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Stylist</span>
            <select
              className={control}
              value={stylistId}
              onChange={(e) => setStylistId(e.target.value)}
            >
              <option value="ALL">All stylists</option>
              {schedule.stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {mode === 'calendar' && date && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => setPickedDate(addDays(date, -step))}
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only">Previous {effectiveView}</span>
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => setPickedDate(today)}
          >
            Today
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => setPickedDate(addDays(date, step))}
          >
            <span aria-hidden="true">→</span>
            <span className="sr-only">Next {effectiveView}</span>
          </button>
          <label className="text-sm">
            <span className="sr-only">Go to date</span>
            <input
              type="date"
              className={control}
              value={date}
              onChange={(e) => e.target.value && setPickedDate(e.target.value)}
            />
          </label>
          <fieldset className="ml-auto flex gap-1">
            <legend className="sr-only">View</legend>
            {(['day', 'week'] as const).map((v) => (
              <label key={v} className="cursor-pointer">
                <input
                  type="radio"
                  name="view"
                  value={v}
                  checked={view === v}
                  onChange={() => setView(v)}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium capitalize peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                  {v}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-5 accent-[var(--color-accent)]"
          />
          Show cancelled and no-shows
        </label>
        {schedule && (
          <p className="text-muted" role="status">
            {visible.length} {visible.length === 1 ? 'booking' : 'bookings'}
            {query.dataUpdatedAt > 0 && (
              <> · updated {clockTime(new Date(query.dataUpdatedAt), branch.timezone)}</>
            )}
          </p>
        )}
      </div>

      {/* Read out by screen readers when a booking arrives; sighted users see the ring. */}
      <p className="sr-only" role="status">
        {freshIds.size > 0
          ? `${freshIds.size} new ${freshIds.size === 1 ? 'booking' : 'bookings'} just arrived.`
          : ''}
      </p>

      {query.isError && (
        <div
          role="alert"
          className="mt-4 rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          {query.error instanceof ApiError && query.error.status === 401 ? (
            <>
              Your session has ended.{' '}
              <a className="font-medium underline" href="/admin/login">
                Sign in again
              </a>
              .
            </>
          ) : schedule ? (
            <>
              Could not refresh just now: showing the last schedule loaded. {errorText(query.error)}
            </>
          ) : (
            <>
              {errorText(query.error)}{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => query.refetch()}
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-4" aria-busy={query.isFetching && !schedule}>
        {!shown && !query.isError && <p className="text-muted">Loading the schedule…</p>}
        {shown && effectiveView === 'day' && date && (
          <>
            <div className="hidden md:block">
              <DayGrid schedule={shown} date={date} now={now} freshIds={freshIds} />
            </div>
            <div className="md:hidden">
              <DayList schedule={shown} freshIds={freshIds} />
            </div>
          </>
        )}
        {shown && effectiveView === 'week' && (
          <WeekColumns
            schedule={shown}
            startDate={shown.range.startDate}
            today={today}
            freshIds={freshIds}
          />
        )}
      </div>
    </div>
  );
}

/** The day as a plain list in time order: how it shows on a phone, where columns would not fit. */
function DayList({ schedule, freshIds }: { schedule: Schedule; freshIds: Set<string> }) {
  if (schedule.appointments.length === 0) {
    return (
      <p className="rounded-card border border-line bg-surface p-6">No bookings for this day.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {schedule.appointments.map((a) => (
        <li key={a.id}>
          <AppointmentCard
            appointment={a}
            timezone={schedule.branch.timezone}
            fresh={freshIds.has(a.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The week as seven day columns of cards (stacked on a phone), each in time order. */
function WeekColumns({
  schedule,
  startDate,
  today,
  freshIds,
}: {
  schedule: Schedule;
  startDate: string;
  today: string | null;
  freshIds: Set<string>;
}) {
  const tz = schedule.branch.timezone;
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  return (
    <ol className="grid gap-3 md:grid-cols-7">
      {days.map((day) => {
        const items = schedule.appointments.filter(
          (a) => localDate(new Date(a.startAt), tz) === day,
        );
        return (
          <li
            key={day}
            className={clsx(
              'rounded-card border bg-surface p-2',
              day === today ? 'border-accent' : 'border-line',
            )}
          >
            <h2 className="px-1 pb-2 text-sm font-semibold">
              {shortDate(day)}
              {day === today && <span className="ml-1 text-accent"> · Today</span>}
            </h2>
            {items.length === 0 ? (
              <p className="px-1 text-sm text-muted">No bookings</p>
            ) : (
              <ul className="space-y-2">
                {items.map((a) => (
                  <li key={a.id}>
                    <AppointmentCard appointment={a} timezone={tz} fresh={freshIds.has(a.id)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
