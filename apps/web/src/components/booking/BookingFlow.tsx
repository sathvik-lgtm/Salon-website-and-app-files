'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { bookingConfig } from '@salon/booking/config';
import { buttonClasses } from '@salon/ui';
import { errorMessage } from '../../lib/booking-copy';
import { readBranchCookie, rememberBranch } from '../../lib/branch-cookie';
import { dayLabel, groupByHour, localDate, longDate, windowDates, addDays } from '../../lib/dates';
import { formatDuration, formatPhone, formatPrice, fullAddress } from '../../lib/format';
import { formatTime } from '../../lib/hours';
import { saveReceipt } from '../../lib/receipt';
import type { BranchView, CategoryView, ServiceView } from '../../lib/types';
import { TurnstileWidget, type TurnstileHandle } from '@salon/ui/turnstile';
import { useJson } from './useJson';

const STEPS = ['Branch', 'Services', 'Stylist', 'Date & time', 'Your details'] as const;
const MAX_SERVICES = 8;

interface Slot {
  time: string;
  startAt: string;
}
interface Stylist {
  id: string;
  name: string;
}

// The branch a visitor probably wants: `?branch=slug` (from a branch page) or the cookie the
// services page sets. Read in the browser only; the server snapshot is null.
const subscribeNever = () => () => {};
const readPreferred = () =>
  new URLSearchParams(window.location.search).get('branch') ?? readBranchCookie(document.cookie);
const serverPreferred = () => null;

const radioPill =
  'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium transition-colors hover:bg-bg peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus';
const inputClass =
  'mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-red-700';

export function BookingFlow({
  branches,
  catalog,
  turnstileSiteKey,
}: {
  branches: BranchView[];
  catalog: CategoryView[];
  turnstileSiteKey: string | undefined;
}) {
  const router = useRouter();
  const [now] = useState(() => new Date());
  const preferred = useSyncExternalStore(subscribeNever, readPreferred, serverPreferred);

  const [step, setStep] = useState(0);
  const [chosenBranch, setChosenBranch] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [stylistId, setStylistId] = useState('ANY');
  const [date, setDate] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null); // 'HH:mm', for the summary
  const [hourChoice, setHourChoice] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [captchaDown, setCaptchaDown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; consent?: string }>({});

  const turnstile = useRef<TurnstileHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  const branch = branches.find((b) => b.slug === (chosenBranch ?? preferred)) ?? null;

  // Services offered at the chosen branch, with that branch's price and time.
  const menu = branch
    ? catalog
        .map((c) => ({ ...c, services: c.services.filter((s) => s.offers[branch.slug]) }))
        .filter((c) => c.services.length > 0)
    : [];
  const chosenServices: ServiceView[] = menu
    .flatMap((c) => c.services)
    .filter((s) => serviceIds.includes(s.id));
  const totalPrice = branch
    ? chosenServices.reduce((n, s) => n + s.offers[branch.slug]!.pricePaise, 0)
    : 0;
  const totalMinutes = branch
    ? chosenServices.reduce((n, s) => n + s.offers[branch.slug]!.durationMin, 0)
    : 0;

  const selection =
    branch && serviceIds.length > 0
      ? `branchId=${branch.id}&serviceIds=${serviceIds.join(',')}`
      : null;
  const stylists = useJson<{ stylists: Stylist[] }>(
    selection && step === 2 ? `/api/stylists?${selection}&_=${refresh}` : null,
  );
  const slots = useJson<{ slots: Slot[] }>(
    selection && date && step === 3
      ? `/api/availability?${selection}&date=${date}&stylistId=${stylistId}&_=${refresh}`
      : null,
  );
  // The stylist's name for the summary comes from the list loaded in the stylist step.
  const [stylistName, setStylistName] = useState('Any available stylist');

  // Move keyboard and screen-reader focus to the new step's heading (but not on first load).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function clearTime() {
    setStartAt(null);
    setStartTime(null);
  }

  function goTo(next: number) {
    setBanner(null);
    setStep(next);
  }

  function chooseBranch(slug: string) {
    if (slug !== branch?.slug) {
      setServiceIds([]);
      setStylistId('ANY');
      setStylistName('Any available stylist');
      setDate(null);
      clearTime();
    }
    setChosenBranch(slug);
    rememberBranch(slug);
  }

  function toggleService(id: string) {
    setServiceIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
    // A different set of services means a different set of qualified stylists and free times.
    setStylistId('ANY');
    setStylistName('Any available stylist');
    clearTime();
  }

  function chooseStylist(id: string, label: string) {
    setStylistId(id);
    setStylistName(label);
    clearTime();
  }

  function chooseDate(next: string) {
    setDate(next);
    clearTime();
    setHourChoice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!branch || !startAt || submitting) return;

    const found: typeof errors = {};
    if (!name.trim()) found.name = 'Please enter your name.';
    if (phone.replace(/\D/g, '').length < 8) found.phone = 'Please enter your mobile number.';
    if (!consent) found.consent = 'Please tick the box to continue.';
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.phone) return phoneRef.current?.focus();
    if (found.consent) return consentRef.current?.focus();
    if (!token) {
      setBanner('Please wait a moment for the security check to finish, then try again.');
      return;
    }

    setSubmitting(true);
    setBanner(null);
    let succeeded = false;
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branch.id,
          serviceIds,
          startAt,
          stylistId,
          name,
          phone,
          consent,
          company_website: trap,
          turnstileToken: token,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        appointment?: {
          id: string;
          staffName: string;
          startAt: string;
          endAt: string;
          totalPricePaise: number;
          totalDurationMin: number;
          items: { serviceName: string; pricePaise: number; durationMin: number }[];
        };
      };

      if (response.status === 201 && body.appointment) {
        const a = body.appointment;
        saveReceipt({
          id: a.id,
          branchName: branch.name,
          branchAddress: fullAddress(branch.address, branch.city),
          branchPhone: branch.phone,
          staffName: a.staffName,
          startAt: a.startAt,
          endAt: a.endAt,
          timezone: branch.timezone,
          totalPricePaise: a.totalPricePaise,
          totalDurationMin: a.totalDurationMin,
          items: a.items,
        });
        succeeded = true;
        router.push('/book/confirmation');
        return;
      }

      const code = body.error;
      setBanner(errorMessage(code, formatPhone(branch.phone)));
      if (code === 'INVALID_PHONE') {
        setErrors({ phone: errorMessage(code) });
        phoneRef.current?.focus();
      } else if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE' || code === 'TOO_SOON') {
        // Back to the times, freshly loaded.
        clearTime();
        setRefresh((n) => n + 1);
        setStep(3);
      } else if (code === 'OUTSIDE_BOOKING_WINDOW') {
        setDate(null);
        clearTime();
        setStep(3);
      }
    } catch {
      setBanner(errorMessage('SERVER_ERROR', formatPhone(branch.phone)));
    } finally {
      setSubmitting(false);
      // A Turnstile token works once, so every failed attempt needs a fresh one.
      if (!succeeded) turnstile.current?.reset();
    }
  }

  const contactPhone = branch ? formatPhone(branch.phone) : undefined;
  const hours = groupByHour(slots.status === 'ready' ? slots.data.slots.map((s) => s.time) : []);
  const activeHour =
    hourChoice !== null && hours.some((h) => h.hour === hourChoice)
      ? hourChoice
      : (hours[0]?.hour ?? null);
  const today = branch ? localDate(now, branch.timezone) : '';
  const dates = branch ? windowDates(now, branch.timezone, bookingConfig.windowDays) : [];

  return (
    <div className="mx-auto max-w-3xl px-4">
      <nav aria-label="Booking progress" className="mb-8">
        <ol className="flex gap-2">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? 'step' : undefined}
              className={clsx(
                'flex-1 border-t-4 pt-2 text-xs font-medium sm:text-sm',
                i < step && 'border-accent text-ink',
                i === step && 'border-accent text-accent',
                i > step && 'border-line text-muted',
              )}
            >
              <span className="sr-only">
                Step {i + 1} of {STEPS.length}:{' '}
              </span>
              <span className={i === step ? '' : 'hidden sm:inline'}>{label}</span>
            </li>
          ))}
        </ol>
      </nav>

      {banner && (
        <p
          role="alert"
          className="mb-6 rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
        >
          {banner}
        </p>
      )}

      {/* ---- 1. Branch ---- */}
      {step === 0 && (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-3xl outline-none">
            Choose a branch
          </h2>
          <fieldset className="mt-6">
            <legend className="sr-only">Branch</legend>
            <div className="grid gap-3">
              {branches.map((b) => (
                <label key={b.slug} className="cursor-pointer">
                  <input
                    type="radio"
                    name="branch"
                    value={b.slug}
                    checked={b.slug === branch?.slug}
                    onChange={() => chooseBranch(b.slug)}
                    className="peer sr-only"
                  />
                  <span className="block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-bg peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                    <span className="block font-medium">{b.name}</span>
                    <span className="block text-sm text-muted">
                      {fullAddress(b.address, b.city)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Nav onNext={branch ? () => goTo(1) : undefined} />
        </section>
      )}

      {/* ---- 2. Services ---- */}
      {step === 1 && branch && (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-3xl outline-none">
            Choose your services
          </h2>
          <p className="mt-2 text-muted">
            At {branch.name}. Several services are done one after another by the same stylist.
          </p>
          {menu.map((category) => (
            <fieldset key={category.slug} className="mt-6">
              <legend className="font-display text-xl">{category.name}</legend>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {category.services.map((s) => {
                  const offer = s.offers[branch.slug]!;
                  const checked = serviceIds.includes(s.id);
                  return (
                    <li key={s.id}>
                      <label className="flex min-h-14 cursor-pointer items-center gap-4 py-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && serviceIds.length >= MAX_SERVICES}
                          onChange={() => toggleService(s.id)}
                          className="size-5 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        />
                        <span className="flex-1">
                          <span className="block font-medium">{s.name}</span>
                          <span className="block text-sm text-muted">
                            {formatDuration(offer.durationMin)}
                          </span>
                        </span>
                        <span className="whitespace-nowrap font-medium">
                          {formatPrice(offer.pricePaise)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
          <p role="status" className="mt-6 font-medium">
            {serviceIds.length === 0
              ? 'Choose at least one service.'
              : `${serviceIds.length} ${serviceIds.length === 1 ? 'service' : 'services'} · ${formatDuration(totalMinutes)} · ${formatPrice(totalPrice)}`}
          </p>
          <Nav onBack={() => goTo(0)} onNext={serviceIds.length > 0 ? () => goTo(2) : undefined} />
        </section>
      )}

      {/* ---- 3. Stylist ---- */}
      {step === 2 && branch && (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-3xl outline-none">
            Choose your stylist
          </h2>
          {stylists.status === 'loading' && (
            <p className="mt-6 text-muted" role="status">
              Finding stylists…
            </p>
          )}
          {stylists.status === 'error' && (
            <div className="mt-6" role="alert">
              <p>{errorMessage(stylists.error, contactPhone)}</p>
              <button
                type="button"
                onClick={() => setRefresh((n) => n + 1)}
                className={buttonClasses({ variant: 'secondary', className: 'mt-3' })}
              >
                Try again
              </button>
            </div>
          )}
          {stylists.status === 'ready' && stylists.data.stylists.length === 0 && (
            <p className="mt-6" role="status">
              No single stylist at {branch.name} does all of these services together. Please go back
              and choose fewer services, or call {contactPhone}.
            </p>
          )}
          {stylists.status === 'ready' && stylists.data.stylists.length > 0 && (
            <fieldset className="mt-6">
              <legend className="sr-only">Stylist</legend>
              <div className="grid gap-3">
                <StylistOption
                  value="ANY"
                  label="Any available stylist"
                  hint="Recommended: we pick the stylist with the most room for you."
                  checked={stylistId === 'ANY'}
                  onChoose={() => chooseStylist('ANY', 'Any available stylist')}
                />
                {stylists.data.stylists.map((s) => (
                  <StylistOption
                    key={s.id}
                    value={s.id}
                    label={s.name}
                    checked={stylistId === s.id}
                    onChoose={() => chooseStylist(s.id, s.name)}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <Nav
            onBack={() => goTo(1)}
            onNext={
              stylists.status === 'ready' && stylists.data.stylists.length > 0
                ? () => goTo(3)
                : undefined
            }
          />
        </section>
      )}

      {/* ---- 4. Date and time ---- */}
      {step === 3 && branch && (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-3xl outline-none">
            Choose a date and time
          </h2>
          <fieldset className="mt-6">
            <legend className="font-medium">Date</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {dates.map((d) => {
                const label = dayLabel(d);
                const tag = d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : null;
                return (
                  <label key={d} className="cursor-pointer">
                    <input
                      type="radio"
                      name="date"
                      value={d}
                      checked={date === d}
                      onChange={() => chooseDate(d)}
                      className="peer sr-only"
                    />
                    <span
                      aria-label={longDate(d)}
                      className={clsx(
                        radioPill,
                        'min-w-20 flex-col justify-center rounded-card py-1 text-center',
                      )}
                    >
                      <span className="text-xs font-normal opacity-80">{tag ?? label.weekday}</span>
                      <span>{label.day}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-8" aria-live="polite">
            {!date && <p className="text-muted">Choose a date to see the times that are free.</p>}
            {date && slots.status === 'loading' && (
              <p className="text-muted">Finding free times…</p>
            )}
            {date && slots.status === 'error' && (
              <div role="alert">
                <p>{errorMessage(slots.error, contactPhone)}</p>
                <button
                  type="button"
                  onClick={() => setRefresh((n) => n + 1)}
                  className={buttonClasses({ variant: 'secondary', className: 'mt-3' })}
                >
                  Try again
                </button>
              </div>
            )}
            {date && slots.status === 'ready' && hours.length === 0 && (
              <p>There are no free times on {longDate(date)}. Please try another day.</p>
            )}
          </div>

          {slots.status === 'ready' && hours.length > 0 && (
            <>
              <fieldset className="mt-2">
                <legend className="font-medium">Hour</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {hours.map((h) => (
                    <label key={h.hour} className="cursor-pointer">
                      <input
                        type="radio"
                        name="hour"
                        value={h.hour}
                        checked={activeHour === h.hour}
                        onChange={() => setHourChoice(h.hour)}
                        className="peer sr-only"
                      />
                      <span className={radioPill}>{h.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="mt-6">
                <legend className="font-medium">Start time</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {hours
                    .find((h) => h.hour === activeHour)
                    ?.times.map((t) => {
                      const slot = slots.data.slots.find((s) => s.time === t)!;
                      return (
                        <label key={t} className="cursor-pointer">
                          <input
                            type="radio"
                            name="time"
                            value={slot.startAt}
                            checked={startAt === slot.startAt}
                            onChange={() => {
                              setStartAt(slot.startAt);
                              setStartTime(t);
                            }}
                            className="peer sr-only"
                          />
                          <span className={radioPill}>{formatTime(t)}</span>
                        </label>
                      );
                    })}
                </div>
              </fieldset>
            </>
          )}
          <p role="status" className="mt-6 font-medium">
            {startTime && date ? `${longDate(date)} at ${formatTime(startTime)}` : ''}
          </p>
          <Nav onBack={() => goTo(2)} onNext={startAt ? () => goTo(4) : undefined} />
        </section>
      )}

      {/* ---- 5. Details and confirm ---- */}
      {step === 4 && branch && date && startAt && startTime && (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-3xl outline-none">
            Your details
          </h2>
          <dl className="mt-6 rounded-card border border-line bg-surface p-4 text-sm">
            <SummaryRow term="Branch" detail={branch.name} />
            <SummaryRow term="Services" detail={chosenServices.map((s) => s.name).join(', ')} />
            <SummaryRow term="Stylist" detail={stylistName} />
            <SummaryRow term="When" detail={`${longDate(date)} at ${formatTime(startTime)}`} />
            <SummaryRow
              term="Total"
              detail={`${formatPrice(totalPrice)} · ${formatDuration(totalMinutes)}`}
            />
          </dl>

          <form onSubmit={submit} noValidate className="mt-8 space-y-5">
            <div>
              <label htmlFor="name" className="font-medium">
                Your name
              </label>
              <input
                ref={nameRef}
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'name-error' : undefined}
                className={inputClass}
              />
              {errors.name && (
                <p id="name-error" className="mt-1 text-sm text-red-800">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="phone" className="font-medium">
                Mobile number
              </label>
              <input
                ref={phoneRef}
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={32}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'phone-hint phone-error' : 'phone-hint'}
                className={inputClass}
              />
              <p id="phone-hint" className="mt-1 text-sm text-muted">
                We use this to contact you about your booking, so please give a mobile number.
                Indian numbers can be written without +91.
              </p>
              {errors.phone && (
                <p id="phone-error" className="mt-1 text-sm text-red-800">
                  {errors.phone}
                </p>
              )}
            </div>

            {/* Honeypot: invisible to people, tempting to bots. Anything typed here rejects the booking. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Leave this field empty
                <input
                  type="text"
                  name="company_website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={trap}
                  onChange={(e) => setTrap(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  ref={consentRef}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? 'consent-error' : undefined}
                  className="mt-1 size-5 shrink-0 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
                <span className="text-sm">
                  I agree to the{' '}
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    Terms of Service<span className="sr-only"> (opens in a new tab)</span>
                  </Link>{' '}
                  and{' '}
                  <Link
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                  , and to {branch.name} keeping my name and phone number to manage my booking.
                </span>
              </label>
              {errors.consent && (
                <p id="consent-error" className="mt-1 text-sm text-red-800">
                  {errors.consent}
                </p>
              )}
            </div>

            {turnstileSiteKey && !captchaDown ? (
              <TurnstileWidget
                ref={turnstile}
                siteKey={turnstileSiteKey}
                onToken={setToken}
                onUnavailable={() => setCaptchaDown(true)}
              />
            ) : (
              <p
                role="alert"
                className="rounded-card border border-red-700 bg-red-50 p-4 text-sm text-red-900"
              >
                The security check could not load. Please reload the page, or call {contactPhone} to
                book.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => goTo(3)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !turnstileSiteKey || captchaDown}
                aria-busy={submitting}
                className={clsx(buttonClasses(), 'disabled:cursor-not-allowed disabled:opacity-60')}
              >
                {submitting ? 'Confirming…' : 'Confirm booking'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function Nav({ onBack, onNext }: { onBack?: () => void; onNext?: () => void }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {onBack && (
        <button type="button" onClick={onBack} className={buttonClasses({ variant: 'secondary' })}>
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={!onNext}
        className={clsx(buttonClasses(), 'disabled:cursor-not-allowed disabled:opacity-50')}
      >
        Continue
      </button>
    </div>
  );
}

function StylistOption({
  value,
  label,
  hint,
  checked,
  onChoose,
}: {
  value: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChoose: () => void;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="radio"
        name="stylist"
        value={value}
        checked={checked}
        onChange={onChoose}
        className="peer sr-only"
      />
      <span className="block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-bg peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function SummaryRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-muted">{term}</dt>
      <dd className="text-right font-medium">{detail}</dd>
    </div>
  );
}
