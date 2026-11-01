import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export interface PhoneOptions {
  /** Country assumed for numbers written without a country code. Default India. */
  country?: CountryCode;
  /**
   * Accept only mobile numbers. Online bookings need this: a salon can only reach a customer on a
   * number that can take a call or message, and "valid" alone still lets through landline-shaped
   * junk such as 1234567890. Staff keying in a phone booking may still enter a landline.
   */
  requireMobile?: boolean;
}

/**
 * Normalise a phone number to E.164 (`+919876543210`), or null if it is not acceptable. Uses the
 * strict ("max") metadata: the small "min" data only checks length and let `1234567890` through as
 * a valid Indian number.
 */
export function normalizePhone(input: string, options: PhoneOptions = {}): string | null {
  const { country = 'IN', requireMobile = false } = options;
  const parsed = parsePhoneNumberFromString(input, country);
  if (!parsed?.isValid()) return null;
  if (requireMobile) {
    const type = parsed.getType();
    if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  }
  return parsed.number;
}
