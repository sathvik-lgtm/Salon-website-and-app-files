# Security

What protects the platform, what is deliberately left open, and what to do if something goes wrong.
Plain language first; the file and test names are there so a developer can check each claim.

## 1. What we are protecting

1. **Customers' names and phone numbers** and their visit history (in the database, and in the staff app).
2. **The staff app**: whoever signs in can see and change bookings.
3. **The appointment book itself**: nobody should be able to fill it with fake bookings or block real customers.

There are no customer accounts, no payments and no card details anywhere in the system.

## 2. The layers

### The public booking API (`POST /api/bookings`)
Checked cheapest first, in this order (`apps/web/src/server/booking-api.ts`):

1. **Same-site check**: the request must come from a page on our own domain (blocks other sites making a
   visitor's browser book for them).
2. **Per-visitor rate limit**: 5 booking attempts a minute per address.
3. **Validation (Zod)**: exact shape; unknown fields are refused; the consent box must be ticked; a hidden
   "honeypot" field must be empty (bots fill it in).
4. **Phone check**: a real Indian mobile number (landlines and made-up numbers are refused).
5. **Turnstile**: Cloudflare's bot check, verified on our server (if Cloudflare cannot be reached, the booking is
   refused, not allowed).
6. **Per-phone rate limit**: 3 attempts an hour per number.
7. **The booking engine** re-checks every rule (opening hours, stylist schedule, time off, notice, 7-day window,
   at most 2 upcoming online bookings per phone), and the **database itself refuses overlapping bookings** for
   one stylist (`Appointment_no_staff_overlap`): even two requests arriving in the same millisecond cannot
   both win. `pnpm --filter @salon/web load-test` proves this with 30 simultaneous attempts.

### The staff app
- Sign-in: email + password, Turnstile, **5 wrong passwords per email and address in 15 minutes locks that
  combination out**, 30 attempts per address in 15 minutes, the same message whether the email exists or not
  (and the same time taken, via a dummy password check), passwords stored as salted PBKDF2-SHA256 hashes.
- Passwords: at least 10 characters with some variety; a temporary password is shown once and must be changed
  at first sign-in.
- Sessions: 8 hours, `HttpOnly`, `SameSite=Lax`, `Secure` on https, only ever sent to `/admin`.
- **Every request re-reads the person from the database** (role, branch, still active), so removing or
  demoting someone takes effect on their next click.
- **Every query is scoped by role and branch on the server** (`apps/staff/src/server/data.ts`, rules in
  `access.ts`). A receptionist at branch A asking for branch B's booking gets "not found", exactly like a
  missing one. Tested against real Postgres (`data.test.ts`) and in the browser (`desk.spec.ts`).
- Stylists are read-only and never see phone numbers. Audit log entries record who changed what.
- No page or API answer is ever cached or indexed (`Cache-Control: private, no-store`, `X-Robots-Tag: noindex`).

### Browser protections (both apps, `packages/security/src/headers.ts`)
Every page and API answer carries:

| Header | Does |
| --- | --- |
| `Content-Security-Policy` | the browser only runs code and loads files from our own site (plus Turnstile on the two pages that use it, and Cloudflare Web Analytics on the public website only); no plugins; no other site may frame us; forms can only post to us |
| `X-Frame-Options: DENY` | the same "no framing" protection for old browsers |
| `Strict-Transport-Security` (1 year) | browsers only ever use https for the site and its subdomains |
| `X-Content-Type-Options: nosniff` | browsers do not guess file types |
| `Referrer-Policy: strict-origin-when-cross-origin` | other sites see only that the visit came from us, never which page |
| `Permissions-Policy` | camera, microphone, location, payment, USB switched off |

Tests: `packages/security/src/hardening.test.ts` (policy contents) and `apps/*/e2e/headers.spec.ts` (headers on real
pages, and that the booking page and sign-in page, including the Turnstile widget, work under the policy with
no violations).

### Secrets and personal data in logs
- Secrets exist only as Cloudflare secrets or local `.env` files that are git-ignored; none is in the repository
  or in any browser bundle (the Turnstile *site* key is public by design).
- **Logs and Sentry never contain names, phone numbers, addresses or request bodies.** The apps' own log lines
  carry event names and error types only. The error reporter (`packages/security/src/error-report.ts`) sends the
  error class, the first line of its message with emails and long digit runs blanked, the code location, the
  route pattern (`/api/bookings`, never the real URL), and the method. No headers, cookies, query strings,
  addresses or user details. Tested with deliberately personal data in the error text.
- Visitor addresses used for rate limits are stored only as a hash, with a short expiry.

## 3. Known gaps and accepted risks

Be aware of these; none is hidden.

1. **A bot that passes Turnstile can still confirm a real slot.** Turnstile stops most automation, not
   all. A determined person could make up to 5 bookings a minute from one address (and a few more from others),
   limited to 2 upcoming online bookings per phone number, and so block some slots with fake names. We accept this
   for launch. **Planned after launch: WhatsApp confirm-tap with auto-release**: a booking made online is
   "pending" until the customer taps a confirm link sent to that phone; unconfirmed slots are released
   automatically after a short time. (Needs notifications, which are outside v0. FUTURE.md.) Until then:
   reception can cancel a suspicious booking in two taps (Cancel booking), and the rate-limit numbers can be
   tightened in `apps/web/src/server/booking-api.ts` (`LIMITS`) and `packages/booking/src/config.ts`.
2. **Rate limits are a coarse brake, not a wall.** The counters live in Cloudflare KV, which is
   *eventually consistent* (two locations can briefly disagree) and cannot count atomically. A fast burst can
   slip a few extra requests through before the counters agree. This is enough to stop casual abuse. If it is
   not, the upgrade is Durable Objects (exact counting; FUTURE.md). The booking engine's own limits (2 upcoming
   per phone, the overlap rule) do not depend on KV.
3. **The policy allows inline scripts** (`'unsafe-inline'` in `script-src`). The website's pages are static, so
   a per-visit secret (a "nonce") cannot be added without making every page dynamic, and Next.js puts the page's own
   data in inline scripts. React escapes everything it displays, and the policy still blocks other sites' code,
   plugins, framing and form theft, but it will not stop an injected inline script if an escaping bug ever
   appeared. Mitigation: `dangerouslySetInnerHTML` is used in exactly one place, the search-engine data block
   (`apps/web/src/components/JsonLd.tsx`), which escapes `<` so nothing in it can end the script; keep it to that
   one place. All content comes from our own database, never from visitors.
4. **No two-factor sign-in for staff** yet (TOTP; the database column exists; FUTURE.md). Use long unique
   passwords, give owners and managers a password manager, and remove accounts when people leave.
5. **A password reset does not end an old session immediately**: a session that was already open keeps
   working until its 8 hours end, though it is forced to the change-password screen first. Real
   revocation is in FUTURE.md. If a device is lost, deactivate the account (takes effect on the next click).
6. **Auth.js is a beta release** (`next-auth@5.0.0-beta.32`, pinned). It is widely used, but expect to update it.
7. **Password hashing strength is capped by Cloudflare Workers** at 100,000 PBKDF2 iterations
   (their limit), below current recommendations for slower hardware. The lockout and Turnstile make guessing
   impractical; moving to a stronger algorithm needs a different runtime or service (FUTURE.md).
8. **`Strict-Transport-Security` includes subdomains.** Every subdomain of the domain must support https
   (Cloudflare provides this automatically for proxied names).
9. **Not yet verified on a real deploy**: the KV counters, the secrets, the Neon pooled connection, the Turnstile
   real keys, the session cookie over https, the headers on the prerendered pages, and Worker start-up time
   (the list is in DEPLOYMENT.md section 11).
10. **Known advisories (2026-11-02, `pnpm audit --prod`): 3, all in build tooling.** `glob` and `minimatch` are used
    by OpenNext's build command (`@opennextjs/cloudflare`), not by the running site: one is a command-injection
    flaw in glob's command-line `-c` option, which nothing here uses; the others are denial-of-service and
    cancellation issues in file matching at build time. They have no fix inside our control (the patched versions
    are majors above what OpenNext asks for). Revisit when OpenNext releases an update; re-run the audit then.
11. **Dependencies**: pnpm refuses package versions younger than a minimum age (a supply-chain defence). Do
    not turn it off. Update with `pnpm update`, run all checks, and read what changed.

## 4. If something goes wrong

- **Suspected leaked secret** (it was pasted somewhere, a laptop was lost): replace it. `AUTH_SECRET`: set a new
  one (`wrangler secret put AUTH_SECRET` on the staff Worker) and redeploy: every staff member is signed out.
  Turnstile secret: rotate it in the Turnstile dashboard, then `wrangler secret put TURNSTILE_SECRET_KEY` on both.
  Database: reset the password in Neon, then update `DATABASE_URL` on both Workers and in the GitHub secrets.
  Backup passphrase: set a new one in GitHub; old files still need the old one, so keep it until they expire.
- **A staff account is compromised or someone leaves**: set the person inactive (Prisma Studio, `Staff.active`
  = false); it works on their next click. Then reset anyone else who shared that password.
- **Fake bookings are flooding in**: Cloudflare dashboard, Security, add a rate-limiting or "Under attack"
  rule for `/api/bookings`, and lower `LIMITS.createPerIp` in the code. Cancel the fakes from the staff app.
- **Customer data may have been exposed**: this is a legal duty under India's DPDP Act (notifying the Data
  Protection Board and the people affected). Take the legal advice for your business; keep the backups and logs.
- **Reporting a vulnerability**: tell the owner directly; do not post it publicly.

## 5. Checks you can run

```
pnpm lint && pnpm typecheck && pnpm test      # includes the access-control tests against real Postgres
pnpm build && pnpm --filter @salon/web e2e && pnpm --filter @salon/staff e2e
pnpm --filter @salon/web load-test            # many people booking one slot at once
pnpm audit --prod                             # known vulnerabilities in dependencies
```
