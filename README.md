# Salon platform

Online booking for a three-branch salon, in two parts:

- **The website** (`apps/web`): the public pages (home, branches, services and prices, offers, privacy, terms)
  and a five-step booking flow. Customers need no account. They choose a branch, services, stylist, date and
  time, enter a name and mobile number, and get an instant confirmation.
- **The staff app** (`apps/staff`): a private app, installable on a phone or desk PC, at `<domain>/admin`.
  Reception, branch managers, stylists and the owner sign in to see the day's bookings, check customers in,
  cancel, add walk-in and phone bookings, and look up clients. What each person can see depends on their role
  and branch.

> **Status (November 2026):** everything is built and tested on a PC and in automated checks. **Nothing is
> deployed yet.** The brand, domain, branches, prices and legal text are placeholders. What remains is the
> first real deploy and launch: see [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

## What has been built

The project was built in milestones. All seven are finished and pushed.

| Milestone | What it delivered |
| --- | --- |
| **M0** Foundation | The project skeleton: one repository holding both apps and shared packages, automated checks on every push (GitHub Actions) |
| **M1** Database | The data model (branches, services, stylists, schedules, customers, appointments, audit log) and a database rule that makes double-booking impossible |
| **M2** Booking engine | The one place that decides which times are free and creates bookings safely, even when many people book at once |
| **M3** Website pages | Home, branches, services with a branch price switcher, offers, privacy, terms, search-engine data, accessibility |
| **M4** Booking flow and API | The five-step booking flow, bot protection (Cloudflare Turnstile), rate limits, confirmation page and calendar file |
| **M5** Staff app | Sign-in with lockouts, role and branch access control, today and calendar views, booking actions, walk-ins, client search, live updates, installable app |
| **M6** Hardening | Security headers, error reporting with no personal details, load test, Lighthouse checks, encrypted backups, health check for uptime monitors, deployment and security guides, launch checklist |

## How it fits together

```
 Customer's phone/browser                    Salon staff (phone / desk PC)
          |                                              |
   https://<domain>/                          https://<domain>/admin
          |                                              |
  +---------------+                              +---------------+
  |  Website      |                              |  Staff app    |
  |  (apps/web)   |                              |  (apps/staff) |
  +-------+-------+                              +-------+-------+
          |   both use the same shared packages          |
          +----------------+-----------------------------+
                           |
        packages/booking  (the booking engine: ALL availability + booking rules)
        packages/db       (database schema, migrations, seed)
        packages/security (rate limits, bot check, security headers, error reports)
        packages/ui, packages/config (shared look and feel)
                           |
                   Postgres database (Neon)
```

Key ideas:

- **One booking brain.** All "is this time free?" and "create this booking" logic lives in
  `packages/booking`. Neither app reimplements it, so the website and the front desk can never disagree.
- **The database is the final referee.** A Postgres rule rejects overlapping bookings for one stylist, so
  even two requests in the same millisecond cannot both win. A load test proves it: 30 people racing for one
  slot gave exactly one booking.
- **The website pages are static.** Content is copied out of the database at build time, so the pages are fast
  and need no database at runtime. Only the booking and availability endpoints are live. (Changing prices or
  offers needs a rebuild: the nightly deploy workflow handles expired offers.)
- **Staff access is checked on the server, every time.** Every staff query starts from the signed-in person's
  role and branch. Asking for another branch's booking looks the same as asking for one that does not exist.
- **No personal details in logs or error reports.**
- **Money** is stored as whole paise (no decimals). **Times** are stored in UTC and shown in each branch's own
  time zone (default India).

### Booking rules (the owner's choices, in `packages/booking/src/config.ts`)

Start times every 5 minutes; at least 20 minutes' notice; bookable up to 7 days ahead; at most 2 upcoming online
bookings per phone number; online bookings need a mobile number. Staff-entered walk-in and phone bookings skip
those customer-facing rules but still respect opening hours, the stylist's shift, time off and overlaps.

## What is in the repository

```
apps/web        Public website + booking API (Next.js)
apps/staff      Private staff app, served under /admin (Next.js)
packages/booking   Booking engine (pure TypeScript, thoroughly tested)
packages/db        Prisma schema, migrations, seed, "create a staff account" tool
packages/security  Rate limiter, Turnstile check, security headers, PII-free error reports
packages/ui        Shared components (buttons, Turnstile widget)
packages/config    Brand name/contact details, colours and fonts, shared settings
scripts/           Database backup, Cloudflare bundle-size measuring
docs/              Everything below
.github/workflows/ Automated checks, nightly website deploy, nightly backup
```

**Tech:** TypeScript, Next.js (App Router), Tailwind CSS, Prisma with Postgres 17, Auth.js (staff sign-in only),
Zod, Vitest and Playwright for tests, pnpm + Turborepo, deployed to Cloudflare Workers with `@opennextjs/cloudflare`.

## Running it on your own PC

You need Node 24, pnpm 12 (`corepack enable`), and Docker Desktop (for the database).

```bash
pnpm install
docker compose up -d                                  # local Postgres on port 5433
cp packages/db/.env.example packages/db/.env          # then the same idea for apps/web/.env.local and apps/staff/.env.local
pnpm db:migrate                                       # create the tables
SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD=choose-a-long-one pnpm db:seed   # placeholder data
pnpm dev                                              # website on :3000, staff app on :3001/admin
```

Each app has a `.env.example` listing what it needs (database address, Turnstile test keys that always pass,
a throwaway `AUTH_SECRET`). The seed loads **fake** branches, prices and staff, and refuses to run against any
database that is not on your own PC.

Create a staff login: `pnpm db:create-staff -- --email a@b.in --name "Name" --role RECEPTIONIST --branch branch-one`
(it prints a one-time password; the person must change it at first sign-in).

### Checks

```bash
pnpm lint && pnpm typecheck && pnpm test      # about 250 unit and database tests
pnpm build
pnpm --filter @salon/web e2e                  # real-browser tests: booking flow, accessibility, security headers
pnpm --filter @salon/staff e2e                # book on the website, see it in the staff app, roles, sign-in
pnpm --filter @salon/web start                # then, in another terminal:
pnpm --filter @salon/web load-test            #   many people booking one slot at once
pnpm --filter @salon/web lighthouse           #   phone Lighthouse on every public page (must be 90+)
bash scripts/backup.sh --verify               # export, encrypt, and prove the backup restores (needs Docker)
```

The same checks run automatically on every push (see `.github/workflows/ci.yml`).

## Documentation

| Document | Read it to |
| --- | --- |
| [docs/BRIEF.md](docs/BRIEF.md) | See the original specification (it wins over everything else) |
| [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) | Know what is left before opening to customers |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Put it on Cloudflare and Neon, set secrets, back up, roll back, monitor |
| [docs/SECURITY.md](docs/SECURITY.md) | Understand the protections, the accepted risks, and what to do in an incident |
| [docs/DECISIONS.md](docs/DECISIONS.md) | See every choice made along the way, and why |
| [docs/FUTURE.md](docs/FUTURE.md) | See ideas and follow-ups that are out of scope for the first version |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Start a new working session (history, current state, next steps) |
| [CLAUDE.md](CLAUDE.md) | The rules and commands for AI coding sessions on this repo |

## What it will cost to run

Prices change; confirm on each provider's page. Detail in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- **Cloudflare Workers Paid:** from $5 USD/month (needed because the Workers are too big and CPU-hungry for the free plan).
- **Neon database:** free to start; the paid Launch plan is recommended for production (7 days of restore history, no sleeping).
- **Cloudflare KV, Turnstile, Web Analytics, R2, Sentry:** free plans are enough for one salon.
- **Domain name:** your registrar's price.

## Known limits (honest list)

- A bot that passes the Turnstile check could still book a real slot. The planned fix after launch is a
  WhatsApp "confirm" tap with automatic release of unconfirmed slots.
- The rate limits are a coarse brake, not a wall.
- No two-factor sign-in for staff yet.
- Not yet verified on a real deployment: the rate-limit counters, secrets, the database connection pooling,
  real Turnstile keys, the staff session cookie over https, and start-up time of the staff Worker.
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) section 11 lists each check.
- Out of scope for the first version: notifications (WhatsApp/SMS/email), payments, customer accounts,
  customer cancel/change pages, admin screens for editing prices and services. See [docs/FUTURE.md](docs/FUTURE.md).
