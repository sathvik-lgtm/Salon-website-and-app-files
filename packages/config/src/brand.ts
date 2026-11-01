/**
 * Single source of truth for brand + contact defaults.
 * Rebranding = edit this file and theme.css. All values are PLACEHOLDERS until the owner supplies real ones.
 */
export const brand = {
  name: 'Placeholder Salon',
  tagline: 'Hair, skin & beauty — placeholder tagline',
  siteUrl: 'https://example.com',
  staffUrl: 'https://staff.example.com',
  defaultTimezone: 'Asia/Kolkata',
  defaultCountry: 'IN',
  currency: 'INR',
  contact: {
    // PLACEHOLDER — replace with real branch numbers in seed/config.
    phone: '+910000000000',
  },
} as const;

export type Brand = typeof brand;
