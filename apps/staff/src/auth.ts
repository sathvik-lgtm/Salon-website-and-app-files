import { verifyPassword } from '@salon/db/password';
import { getEnv } from '@salon/security/env';
import { hashId } from '@salon/security/rate-limit';
import { clientIp } from '@salon/security/request';
import { verifyTurnstile } from '@salon/security/turnstile';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { attemptLogin } from './server/login';
import { getLimiter, log, withDb } from './server/runtime';

/**
 * Staff sign-in (Auth.js, credentials, JWT session in a cookie). Customers never sign in anywhere.
 *
 * The cookie holds only WHO the person is (their id). Their role, branch and whether they are still
 * active are re-read from the database on every request (see server/session.ts), so a deactivated or
 * demoted person loses access at once instead of when the cookie expires.
 */

/** A shift: a session lasts 8 hours, then the person signs in again. */
export const SESSION_SECONDS = 8 * 60 * 60;

/** Each failure reason gets a code the sign-in form can turn into plain words (and nothing more). */
class InvalidLogin extends CredentialsSignin {
  override code = 'invalid';
}
class LockedLogin extends CredentialsSignin {
  override code = 'locked';
}
class CaptchaLogin extends CredentialsSignin {
  override code = 'captcha';
}
class UnavailableLogin extends CredentialsSignin {
  override code = 'unavailable';
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  // https makes the cookie Secure and gives it the __Secure- prefix. The path keeps it away from the
  // public website, which shares the domain.
  const secure = (getEnv('AUTH_URL') ?? '').startsWith('https://');
  return {
    secret: getEnv('AUTH_SECRET'),
    trustHost: true,
    // Auth.js would print a full stack trace for every wrong password. Log only the kind of event.
    logger: {
      error: (error) => log('auth_error', { type: (error as { type?: string }).type ?? 'unknown' }),
      warn: (code) => log('auth_warning', { code }),
      debug: () => {},
    },
    basePath: '/admin/api/auth',
    pages: { signIn: '/admin/login' },
    session: { strategy: 'jwt' as const, maxAge: SESSION_SECONDS },
    useSecureCookies: secure,
    cookies: {
      sessionToken: {
        name: secure ? '__Secure-salon-staff.session' : 'salon-staff.session',
        options: { httpOnly: true, sameSite: 'lax' as const, path: '/admin', secure },
      },
    },
    providers: [
      Credentials({
        credentials: { email: {}, password: {}, turnstileToken: {} },
        authorize: async (credentials, request) => {
          const result = await withDb((db) =>
            attemptLogin(credentials, clientIp(request), {
              limiter: getLimiter(),
              verifyTurnstile: (token, ip) =>
                verifyTurnstile({ token, ip, secret: getEnv('TURNSTILE_SECRET_KEY') }),
              findStaff: (email) =>
                db.staff.findUnique({
                  where: { email },
                  select: { id: true, email: true, name: true, passwordHash: true, active: true },
                }),
              verifyPassword,
              hashId,
              log,
            }),
          );
          if (result.ok) return result.staff;
          switch (result.reason) {
            case 'locked':
              throw new LockedLogin();
            case 'captcha':
              throw new CaptchaLogin();
            case 'unavailable':
              throw new UnavailableLogin();
            default:
              throw new InvalidLogin();
          }
        },
      }),
    ],
    callbacks: {
      // Keep only the person's id in the cookie.
      jwt: ({ token, user }) => {
        if (user?.id) token.sub = user.id;
        return token;
      },
      session: ({ session, token }) => {
        if (token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
});
