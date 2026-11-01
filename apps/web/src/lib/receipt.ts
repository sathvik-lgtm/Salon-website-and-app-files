/**
 * What the confirmation page shows. The booking API returns it once, the browser keeps it in
 * sessionStorage for this tab, and the confirmation page reads it from there. There is deliberately
 * no page that looks a booking up by id: customers have no accounts, and an id in a URL would let
 * anyone who guessed or saw it read someone else's name-linked booking details.
 */
export interface BookingReceipt {
  id: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  staffName: string;
  /** ISO instants (UTC). */
  startAt: string;
  endAt: string;
  timezone: string;
  totalPricePaise: number;
  totalDurationMin: number;
  items: { serviceName: string; pricePaise: number; durationMin: number }[];
}

export const RECEIPT_KEY = 'salon_last_booking';

/** Accepts only a well-formed receipt; anything else (old, edited, missing) is null. */
export function parseReceipt(value: unknown): BookingReceipt | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  const strings = [
    'id',
    'branchName',
    'branchAddress',
    'branchPhone',
    'staffName',
    'startAt',
    'endAt',
    'timezone',
  ];
  if (!strings.every((k) => typeof r[k] === 'string')) return null;
  if (typeof r.totalPricePaise !== 'number' || typeof r.totalDurationMin !== 'number') return null;
  if (Number.isNaN(Date.parse(r.startAt as string)) || Number.isNaN(Date.parse(r.endAt as string)))
    return null;
  if (!Array.isArray(r.items) || r.items.length === 0) return null;
  const itemsOk = r.items.every(
    (i) =>
      typeof i === 'object' &&
      i !== null &&
      typeof (i as Record<string, unknown>).serviceName === 'string' &&
      typeof (i as Record<string, unknown>).pricePaise === 'number' &&
      typeof (i as Record<string, unknown>).durationMin === 'number',
  );
  return itemsOk ? (value as BookingReceipt) : null;
}

export function saveReceipt(receipt: BookingReceipt): void {
  try {
    sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(receipt));
  } catch {
    // Storage can be blocked (private mode): the confirmation page then shows its fallback message.
  }
}

/** The raw stored text, for `useSyncExternalStore` (a string compares by value, so it never loops). */
export function readReceiptText(): string | null {
  try {
    return sessionStorage.getItem(RECEIPT_KEY);
  } catch {
    return null;
  }
}

export function receiptFromText(text: string | null): BookingReceipt | null {
  if (!text) return null;
  try {
    return parseReceipt(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A short reference to quote when phoning: the last 8 characters of the id. */
export function bookingReference(id: string): string {
  return id.slice(-8).toUpperCase();
}
