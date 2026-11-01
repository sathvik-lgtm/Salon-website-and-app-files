/** Small request checks shared by the API routes. */

/**
 * CSRF defence for state-changing requests: the request must come from a page on this same site.
 * Browsers always send `Origin` on a cross-site POST; `Referer` is the fallback. Neither present, or
 * a different host, means refuse.
 */
export function isSameOrigin(request: Request): boolean {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source || source === 'null') return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/**
 * The visitor's address for rate limiting. Behind Cloudflare, `cf-connecting-ip` is set by
 * Cloudflare itself and cannot be forged by the visitor.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}
