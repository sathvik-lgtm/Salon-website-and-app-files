import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * Normalise a phone number to E.164 (`+919876543210`), or null if it is not a valid number.
 * Numbers without a country code are read as Indian. Uses the `min` metadata to keep the bundle small.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'IN'): string | null {
  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}
