'use client';

import { buttonClasses } from '@salon/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { OfferedService } from '../server/data';
import { ApiError, errorText, getJson, postJson } from '../lib/api-client';
import { clockTime, dateAndTime, hhmmOf, localDate, zonedInstant } from '../lib/dates';
import { formatDuration, formatPrice } from '../lib/format';
import { formatMinutes } from '../lib/dates';
import type { BranchOption } from './schedule/ScheduleView';
import { useNow } from './schedule/useNow';

const field =
  'mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

interface Created {
  appointment: {
    id: string;
    staffName: string;
    startAt: string;
    endAt: string;
    totalPricePaise: number;
    totalDurationMin: number;
    items: { serviceName: string }[];
  };
}

/**
 * A walk-in or phone booking. It goes through the same booking engine as the website, so a stylist
 * can never be double booked; only the customer-facing rules (5-minute grid, minimum notice, 7-day
 * window, per-phone cap, mobile-only) are relaxed for the desk.
 */
export function NewBooking({
  branches,
  defaultBranchId,
}: {
  branches: BranchOption[];
  defaultBranchId: string;
}) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const branch = branches.find((b) => b.id === branchId) ?? branches[0]!;
  const [source, setSource] = useState<'WALK_IN' | 'PHONE'>('WALK_IN');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [stylistId, setStylistId] = useState('ANY');
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const today = now === null ? null : localDate(new Date(now), branch.timezone);
  const date = pickedDate ?? today;
  const serviceKey = serviceIds.join(',');

  const services = useQuery({
    queryKey: ['desk-services', branchId],
    queryFn: ({ signal }) =>
      getJson<{ services: OfferedService[] }>(`/admin/api/services?branchId=${branchId}`, signal),
  });
  const stylists = useQuery({
    queryKey: ['desk-stylists', branchId, serviceKey],
    enabled: serviceIds.length > 0,
    queryFn: ({ signal }) =>
      getJson<{ stylists: { id: string; name: string }[] }>(
        `/admin/api/stylists?branchId=${branchId}&serviceIds=${serviceKey}`,
        signal,
      ),
  });
  const slots = useQuery({
    queryKey: ['desk-slots', branchId, serviceKey, date, stylistId],
    enabled: serviceIds.length > 0 && date !== null,
    queryFn: ({ signal }) =>
      getJson<{ slots: { time: string; startAt: string }[] }>(
        `/admin/api/slots?branchId=${branchId}&serviceIds=${serviceKey}&date=${date}&stylistId=${stylistId}`,
        signal,
      ),
  });

  const create = useMutation({
    mutationFn: (input: { startAt: string }) =>
      postJson<Created>('/admin/api/bookings', {
        branchId,
        serviceIds,
        stylistId,
        name,
        phone,
        source,
        ...input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.code === 'SLOT_TAKEN' || error.code === 'SLOT_UNAVAILABLE')
      ) {
        void queryClient.invalidateQueries({ queryKey: ['desk-slots'] });
      }
    },
  });

  const chosen = (services.data?.services ?? []).filter((s) => serviceIds.includes(s.id));
  const totalPrice = chosen.reduce((n, s) => n + s.pricePaise, 0);
  const totalMin = chosen.reduce((n, s) => n + s.durationMin, 0);

  function reset() {
    setServiceIds([]);
    setStylistId('ANY');
    setPickedDate(null);
    setTime('');
    setName('');
    setPhone('');
    setProblem(null);
    create.reset();
  }

  function startNow() {
    // Event handler: reading the clock here is fine.
    const at = new Date();
    setPickedDate(null);
    setTime(hhmmOf(at, branch.timezone));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (serviceIds.length === 0) return setProblem('Choose at least one service.');
    if (!date || !time)
      return setProblem('Choose the date and start time, or press "Start right now".');
    if (!name.trim()) return setProblem("Enter the customer's name.");
    if (phone.replace(/\D/g, '').length < 5)
      return setProblem("Enter the customer's phone number.");
    create.mutate({ startAt: zonedInstant(date, time, branch.timezone) });
  }

  if (create.isSuccess) {
    const a = create.data.appointment;
    return (
      <div className="max-w-xl rounded-card border border-line bg-surface p-6" role="status">
        <h1 className="font-display text-3xl">Booked</h1>
        <p className="mt-2">
          {a.items.map((i) => i.serviceName).join(', ')} with {a.staffName},{' '}
          <strong>{dateAndTime(a.startAt, branch.timezone)}</strong> to{' '}
          {clockTime(a.endAt, branch.timezone)}. {formatPrice(a.totalPricePaise)}.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/bookings/${a.id}`} className={buttonClasses()}>
            Open the booking
          </Link>
          <button type="button" onClick={reset} className={buttonClasses({ variant: 'secondary' })}>
            Book another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-8">
      <h1 className="font-display text-3xl">New booking</h1>

      {(problem || create.isError) && (
        <p
          role="alert"
          className="rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          {problem ?? errorText(create.error)}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {branches.length > 1 && (
          <label className="text-sm font-medium">
            Branch
            <select
              className={field}
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setServiceIds([]);
                setStylistId('ANY');
                setTime('');
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset>
          <legend className="text-sm font-medium">How did they book?</legend>
          <div className="mt-1 flex gap-2">
            {(['WALK_IN', 'PHONE'] as const).map((s) => (
              <label key={s} className="cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value={s}
                  checked={source === s}
                  onChange={() => setSource(s)}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                  {s === 'WALK_IN' ? 'Walk-in' : 'By phone'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset>
        <legend className="font-display text-xl">Services</legend>
        {services.isPending && <p className="mt-2 text-muted">Loading services…</p>}
        {services.isError && (
          <p className="mt-2 text-sm text-red-900">{errorText(services.error)}</p>
        )}
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {(services.data?.services ?? []).map((s) => (
            <li key={s.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={serviceIds.includes(s.id)}
                  onChange={() => {
                    setServiceIds((cur) =>
                      cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                    );
                    setStylistId('ANY');
                    setTime('');
                  }}
                  className="size-5 accent-[var(--color-accent)]"
                />
                <span className="flex-1">
                  {s.name}
                  <span className="text-muted"> · {formatDuration(s.durationMin)}</span>
                </span>
                <span className="font-medium">{formatPrice(s.pricePaise)}</span>
              </label>
            </li>
          ))}
        </ul>
        {serviceIds.length > 0 && (
          <p className="mt-2 text-sm font-medium" role="status">
            {formatDuration(totalMin)} · {formatPrice(totalPrice)}
          </p>
        )}
      </fieldset>

      {serviceIds.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Stylist
            <select
              className={field}
              value={stylistId}
              onChange={(e) => {
                setStylistId(e.target.value);
                setTime('');
              }}
              disabled={stylists.isPending}
            >
              <option value="ANY">Any available stylist</option>
              {(stylists.data?.stylists ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {stylists.isSuccess && stylists.data.stylists.length === 0 && (
              <span className="mt-1 block font-normal text-red-900">
                No single stylist does all of these together.
              </span>
            )}
          </label>
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="font-display text-xl">When</legend>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium">
            Date
            <input
              type="date"
              className={field}
              value={date ?? ''}
              onChange={(e) => setPickedDate(e.target.value || null)}
            />
          </label>
          <label className="text-sm font-medium">
            Start time
            <input
              type="time"
              className={field}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={startNow}
            className={buttonClasses({ variant: 'secondary' })}
          >
            Start right now
          </button>
        </div>
        {serviceIds.length > 0 && (
          <label className="block text-sm font-medium">
            Or pick a free time
            <select
              className={field}
              value={slots.data?.slots.some((s) => s.time === time) ? time : ''}
              onChange={(e) => setTime(e.target.value)}
              disabled={!slots.isSuccess}
            >
              <option value="">
                {slots.isPending
                  ? 'Finding free times…'
                  : slots.isError
                    ? 'Could not load free times'
                    : slots.data?.slots.length
                      ? 'Choose a free time'
                      : 'No free times on this day'}
              </option>
              {(slots.data?.slots ?? []).map((s) => (
                <option key={s.startAt} value={s.time}>
                  {formatMinutes(Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)))}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-display text-xl">Customer</legend>
        <label className="text-sm font-medium">
          Name
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={100}
          />
        </label>
        <label className="text-sm font-medium">
          Phone number
          <input
            className={field}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={32}
          />
          <span className="mt-1 block font-normal text-muted">
            Mobile or landline. Indian numbers can be written without +91.
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={create.isPending}
        aria-busy={create.isPending}
        className={buttonClasses({ className: 'disabled:opacity-60' })}
      >
        {create.isPending ? 'Booking…' : 'Book it'}
      </button>
    </form>
  );
}
