/**
 * The visitor's chosen branch is remembered in a plain cookie holding the branch slug. It is written
 * by the services branch switcher and read by the booking flow (M4) as the default branch. It is not
 * sensitive, so it is not httpOnly: the static pages set it from the browser.
 */
export const BRANCH_COOKIE = 'salon_branch';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function branchCookieString(slug: string): string {
  return `${BRANCH_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The saved slug from a `document.cookie` / `Cookie` header string, or null. */
export function readBranchCookie(cookies: string): string | null {
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === BRANCH_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}
