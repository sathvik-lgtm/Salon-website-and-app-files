export interface HeaderPair {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /** Next's development server needs eval for its error overlay; a production build never does. */
  development?: boolean;
  /** Pages that load Cloudflare's Turnstile widget (it needs its script and a frame). */
  turnstile?: boolean;
  /** The public website only: Cloudflare Web Analytics. The staff app never loads third-party scripts except Turnstile. */
  analytics?: boolean;
}

const TURNSTILE = 'https://challenges.cloudflare.com';
// Cloudflare Web Analytics: the beacon script and the address it reports to (Cloudflare's CSP guide).
const ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com';
const ANALYTICS_REPORT = 'https://cloudflareinsights.com';

/**
 * The Content-Security-Policy. Scripts need 'unsafe-inline' because Next puts the page's own data in
 * inline scripts and the website's pages are static (a per-request nonce would make them dynamic).
 * Everything else is closed: no other origins, no plugins, no framing, forms only to ourselves.
 */
export function contentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const scripts = ["'self'", "'unsafe-inline'"];
  if (options.analytics) scripts.push(ANALYTICS_SCRIPT);
  if (options.development) scripts.push("'unsafe-eval'");
  if (options.turnstile) scripts.push(TURNSTILE);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scripts,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': options.analytics ? ["'self'", ANALYTICS_REPORT] : ["'self'"],
    'frame-src': options.turnstile ? [TURNSTILE] : ["'none'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** The headers every page and API response carries (both apps). */
export function securityHeaders(options: SecurityHeaderOptions = {}): HeaderPair[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Older browsers ignore frame-ancestors; this covers them.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    // One year, HTTPS only. Browsers ignore this header over plain http, so local testing is unaffected.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ];
}
