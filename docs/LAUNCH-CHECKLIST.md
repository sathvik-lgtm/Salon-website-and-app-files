# Launch checklist

Tick each line (`[x]`) when it is done and you have seen it work. "How" points to the section of
[DEPLOYMENT.md](DEPLOYMENT.md) (D) or [SECURITY.md](SECURITY.md) (S). Nothing is deployed yet; everything
marked "already done" was checked on a PC and in CI.

## A. Already done (checked in CI on every push)

- [x] Lint, type-check, about 250 unit and database tests, production build
- [x] Booking engine: no double-booking under 30 simultaneous attempts (load test), database-enforced
- [x] Browser tests of the whole booking flow (phone and desktop) and of the staff app, including that a
      receptionist at one branch cannot see another branch's bookings
- [x] Accessibility (axe) clean on every public and staff screen
- [x] Lighthouse on phone: 92 or more for speed, accessibility, best practices and SEO on all 8 public pages
- [x] Security headers and content policy on both apps, tested in a real browser with Turnstile working
- [x] Server errors reported without personal details (tested)
- [x] Nightly backup and restore proven on a copy of the database
- [x] Placeholder-data guard: the seed script refuses a database that is not on your own PC

## B. Business content (you)

- [ ] Real brand name, tagline, logo and colours (`packages/config/src/brand.ts`, `theme.css`, icons in both apps)
- [ ] Real domain written into `siteUrl` and `staffUrl` in `brand.ts` (currently `https://example.com`)
- [ ] Real branches (names, addresses, phone numbers, opening hours, maps), services, prices, durations
- [ ] Real stylists with their services and weekly shifts; time off entered (D 3.2)
- [ ] Real photographs (branches, hero, promotions), with permission from anyone shown
- [ ] Privacy policy and terms **written or checked by someone qualified** (the bracketed `[ ... ]` parts of
      `apps/web/src/app/privacy/page.tsx` and `terms/page.tsx` are placeholders). Include who the grievance
      officer is, how long bookings are kept, and which providers see the data (Cloudflare, Neon, Sentry)
- [ ] Decide the booking rules still at their starting values (5-minute grid, 20 minutes' notice, 7 days
      ahead, 2 upcoming bookings per phone: `packages/booking/src/config.ts`)
- [ ] The 3 branches agree on a **procedure for walk-ins and phone bookings** (they are entered in the staff app)

## C. Accounts and setup (D sections 2 and 3)

- [ ] Cloudflare account, domain added and **Active**; Workers **Paid** plan (from $5 USD/month)
- [ ] Neon project (Postgres 17, nearest region); decide Free or **Launch** (Launch: 7 days of restore history and no sleeping)
- [ ] Tables created with `pnpm db:migrate` against the **direct** Neon string (D 3.2)
- [ ] Turnstile widget created for the domain; real site key and secret in hand (D 3.3)
- [ ] KV namespace created; the **same id** pasted into **both** `wrangler.jsonc` files (D 3.4)
- [ ] Routes added: `<domain>/*` for the website, `<domain>/admin*` for the staff app (D 3.5)
- [ ] Secrets set on **both** Workers: `DATABASE_URL` (pooled), `TURNSTILE_SECRET_KEY`; on staff also
      `AUTH_SECRET` (new random value) and variable `AUTH_URL=https://<domain>/admin/api/auth` (D 3.6)
- [ ] `DB_DRIVER` is **not** set on Cloudflare
- [ ] Sentry project created, `SENTRY_DSN` set on both Workers (D 3.8)
- [ ] First OWNER account created, signed in, password changed (D 8)
- [ ] Staff accounts created for every receptionist, manager and stylist; each signs in and changes the password
- [ ] GitHub secrets for the nightly deploy and the nightly backup (D 5, D 7)

## D. First deploy and checks (D 4 and D 11)

- [ ] Website deployed; staff app deployed; both Workers **start** (watch for startup or size errors; stop and
      ask if any appears)
- [ ] Open the site on a **real phone** over mobile data: home, services, a branch, offers, book
- [ ] Make a real test booking end to end with the real Turnstile; it appears in the staff app within about 20
      seconds, with the "New" badge; cancel it afterwards
- [ ] Two phones try to book the same stylist and time together: one succeeds, the other is told it is taken
- [ ] 6 quick booking attempts from one phone: the 6th is refused politely (rate limit works on the live KV)
- [ ] Staff sign-in works over https and survives a reload; 5 wrong passwords lock that email out for a while
- [ ] A receptionist at branch A cannot open a branch B booking by changing the address
- [ ] `curl -sI https://<domain>/` and `https://<domain>/admin/login` show the security headers; no
      policy errors in the browser console on `/`, `/book` and `/admin/login` (D 11 item 6)
- [ ] Lighthouse against the live address: 90 or more (`BASE_URL=https://<domain> pnpm --filter @salon/web lighthouse`)
- [ ] A test error shows up in Sentry with nothing personal in it
- [ ] Install the staff app on a phone and a desk PC ("Add to home screen" / "Install")

## E. Safety nets (D 7 and 9)

- [ ] **Backup workflow run by hand once**: green, and a `.enc` file is in the R2 bucket
- [ ] The backup passphrase is saved in a password manager (not only in GitHub)
- [ ] Neon restore tried once on a rehearsal branch (Console, Backup & Restore)
- [ ] Uptime monitors on `/api/health` and `/admin/login`; alerts reach your phone; a deliberate outage test
- [ ] Usage alerts set in Cloudflare and Neon
- [ ] You know how to roll back (D 6): try `wrangler rollback` once on a rehearsal Worker

## F. People

- [ ] Reception staff have had 15 minutes on the staff app: today view, check-in, walk-in booking, cancel,
      client search
- [ ] A written note of who to call when the site is down, and what reception does meanwhile (phones and a
      paper book still work: the staff app is not the only way to take a booking)
- [ ] The branches' phone numbers on the site are the numbers that will be answered

## G. After launch (first week)

- [ ] Check Sentry, uptime and Cloudflare dashboards each morning
- [ ] Look for fake bookings; cancel them; tighten limits if needed (S 3 item 1, S 4)
- [ ] Review the Cloudflare Workers dashboard: CPU time per request (the staff sign-in is the heaviest) and the monthly cost
- [ ] Re-run `pnpm audit --prod` and update dependencies that have fixes (S 3 item 10)
- [ ] Decide the next milestone from FUTURE.md: admin screens for prices and promotions, WhatsApp confirmation
      (which also closes the biggest security gap), customer cancel/change
