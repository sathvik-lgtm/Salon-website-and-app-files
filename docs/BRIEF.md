# Build brief: Salon platform v0 (customer website + staff web app)

You are building the first launchable version (v0) of a booking platform for a salon with **3 branches**. I am the sole developer and maintainer, so favour boring, well-documented, low-maintenance choices. Read this whole brief before doing anything.

## 0. How to work

1. **Start in plan mode.** Read this brief and any files in `docs/` (see section 12), then produce a written plan: repo layout, milestone breakdown, and a short list of **blocking** questions (maximum 5). Do not write application code until I approve the plan.
2. After approval, build milestone by milestone (section 11). At the end of each milestone: run lint, type-check, tests and build; commit; give me a summary of 10 lines or fewer. **Stop for my review after Milestone 2 (booking engine)**, because everything depends on it. After that, continue through the milestones without waiting unless blocked.
3. Where something is not specified, choose the simplest sensible option, and record it in `docs/DECISIONS.md` (one line: decision, reason). Do not ask me about things with an obvious default.
4. **Verify current facts before relying on them.** Library versions, Cloudflare limits and adapter behaviour change. Check the current official docs for Next.js, `@opennextjs/cloudflare`, Prisma (Workers and Neon driver adapter support), Auth.js and Cloudflare Workers limits. Do not code from memory where they matter.
5. Never commit secrets. Provide `.env.example` files. Never invent real business data: all seed data must be clearly marked placeholder.
6. Keep scope tight. If you think something is missing, add it to `docs/FUTURE.md` rather than building it.

## 1. Product summary

Two applications sharing one database and one booking engine:

- **Customer website** (public, ~80-100 visitors/day, worst case ~100): view per-branch info, browse the service menu with per-branch pricing, book an appointment online, see promotions and membership plans.
- **Staff web app** (private, installable PWA, used at the front desk in Chrome): view and manage bookings, add walk-ins, look up clients.

## 2. Scope of v0

### In scope: customer website
- **Home**: hero, featured services, the 3 branch cards, clear Book CTA.
- **Branches**: overview page and `/branches/[slug]` with address, hours (and open-now state), phone (`tel:` link), embedded map or map link, that branch's services.
- **Services menu** (`/services`, plus `/services/[category]`): branch switcher. Prices and durations reflect per-branch overrides; services unavailable at a branch are hidden for that branch. Remember the chosen branch in a cookie and use it as the default on the booking flow.
- **Booking flow** (`/book`): branch, service(s), stylist (a specific stylist **or** "any available"), date and time, customer name and phone, confirm. The booking is **confirmed instantly** (status `CONFIRMED`, no staff approval step). Then a confirmation page with full details and an "Add to calendar" (.ics) button. Cancellation and changes happen by phoning the branch, so show the branch phone number on the confirmation page.
- **Promotions and Membership page** (`/offers`): current promotions (active, within date range, per branch or all branches) and membership plans (price, billing period, perks). **Informational only**: no checkout, no payments. A secondary header button, **"Offers & Memberships"**, sits beside the primary **"Book appointment"** button (and in the mobile menu / sticky bar).
- **Legal pages**: Privacy Policy and Terms of Service (placeholder copy, clearly marked for legal review) plus a "request data deletion" section describing a manual process (contact the branch). The booking form needs a consent line linking to both. Context: India's DPDP Act, because phone numbers and booking history are collected.

### In scope: staff app (`staff.` subdomain, login required)
- Login, logout, session expiry. No public sign-up. Staff accounts are created by a CLI/seed script (`pnpm db:create-staff`), and an OWNER can create and reset staff from a minimal UI if time allows (otherwise CLI only).
- **Password reset without email**: there is no email service. An OWNER or BRANCH_MANAGER can set a one-time temporary password for a staff member, forcing a change at next login. The OWNER's reset is done via the CLI script.
- **Today view** and **calendar** (day and week), one column per stylist, filterable by branch and stylist, current time marked.
- **Booking details** and actions: check in, complete, cancel, no-show.
- **Walk-in and phone bookings** created by staff through the same booking engine.
- **Client lookup** by phone number, with visit history.
- New online bookings appear without a manual refresh (use **polling every ~20s** via TanStack Query, with a subtle highlight for new items; no WebSockets in v0).
- **Roles, enforced on the server for every query and mutation** (scope by the branch in the session, never trust the client): `OWNER` (all branches), `BRANCH_MANAGER` (own branch), `RECEPTIONIST` (own branch bookings and clients), `STYLIST` (own schedule only).
- PWA: valid manifest and installable. Read-only offline cache of today's schedule is a **stretch goal** (do last, only if cheap), with a visible "offline, showing saved schedule" banner. Booking creation requires a connection.
- Audit log entries (`AuditLog`) for cancel, no-show, status changes and reschedules.
- Security extras: login rate limiting (section 7). TOTP 2FA for OWNER and BRANCH_MANAGER is a **stretch goal inside v0**; structure the auth so it can be added without a rewrite, and put it in `docs/FUTURE.md` if skipped.

### Explicitly OUT of scope for v0 (do not build; schema may already contain fields)
WhatsApp or any notification (no Meta API, no queue, no webhooks, no cron reminders, no SMS, no email) · deposits or any payments · POS and inventory · waitlist · recurring appointments · cancellation-policy enforcement · reviews display / Google Places · business analytics dashboard (only add the Cloudflare Web Analytics snippet) · customer accounts · a customer self-service manage/cancel page · client-notes UI (see section 4: the field exists but stays hidden, it needs owner review) · full admin CRUD screens for services, prices, staff schedules, promotions and memberships (v0 content is managed through the seed script and Prisma Studio; admin screens are the first post-launch milestone).

## 3. Tech stack (decided; do not substitute without telling me why)

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Framework | Next.js (App Router) + TypeScript (strict) for both apps |
| UI | Tailwind CSS + shadcn/ui; Framer Motion used sparingly |
| Database | Neon Postgres (free tier), Prisma ORM |
| Auth (staff only) | Auth.js, credentials provider, JWT or DB sessions, roles in the session |
| Validation | Zod everywhere on the server; `libphonenumber-js` for phones |
| Hosting | **Cloudflare** (Workers via `@opennextjs/cloudflare`; Pages if that is what current docs recommend for Next.js), one project per app |
| Images | Cloudflare R2 |
| Bot protection | Cloudflare Turnstile |
| Rate limiting | Cloudflare KV (or Durable Objects if KV's consistency is a problem) |
| Monitoring | Sentry (free tier), UptimeRobot, Cloudflare Web Analytics |
| Tests | Vitest (unit, booking engine), Playwright (e2e) |
| CI | GitHub Actions: lint, type-check, test, build on every PR |

Hard constraints from the hosting choice, which you must **verify and handle**:
- **Prisma on Workers**: use the Neon serverless driver adapter and a Workers-compatible Prisma setup per current docs. If this proves unworkable, tell me and propose Drizzle as the fallback **before** switching. If you switch, keep `docs/schema.prisma` semantics identical.
- **Workers limits**: check the current free-plan bundle-size and CPU-time limits against a real OpenNext build. My budget assumes the free plan (~₹0/month). If the build cannot fit, **stop and tell me** the smallest paid option and its cost; do not silently change the plan.
- **Password hashing** must be Workers-compatible and fit within CPU limits (no native bcrypt). Pick a suitable WebCrypto or pure-JS scheme and test its CPU cost.
- Money is stored as integer **paise** (INR). Display with `Intl.NumberFormat('en-IN')`.

## 4. Data model

The reference schema is `docs/schema.prisma`. Treat it as the source of truth and keep it, with these required changes and notes:

- **Overlap constraint** (the single most important rule: no double-booking, enforced in Postgres, not just in app code). Add a raw-SQL migration: `CREATE EXTENSION IF NOT EXISTS btree_gist;` and an `EXCLUDE USING gist` constraint on the appointment's stylist id and `tstzrange(startAt, endAt)` (use the real quoted Prisma column names). Apply it to every status **except** `CANCELLED` and `NO_SHOW`, so `PENDING`, `CONFIRMED`, `CHECKED_IN` and `COMPLETED` all occupy time. (The comment in the reference file lists only two statuses, which is incomplete.) The end of one booking may equal the start of the next.
- **Store all instants in UTC**; interpret branch hours and staff schedules in the branch's `timezone` (default `Asia/Kolkata`). Use Luxon or date-fns-tz.
- `Staff.homeBranchId` is required and fixed: a stylist belongs to exactly one branch.
- `Staff.email` is only a login identifier (no email is ever sent).
- Prices and durations are snapshotted onto `AppointmentItem` at booking time.
- Appointments created online or by staff start as `CONFIRMED`. `manageTokenHash` is required by the schema: generate and store a random token hash anyway (future use), but expose no manage page in v0.
- `Customer.notes` exists but is marked **NEEDS REVIEW**: do not read or show it anywhere in v0 UI.
- `Customer.whatsappOptIn` stays `false`; the booking form shows no WhatsApp wording in v0.
- `NotificationLog`, `ReviewCache` remain in the schema, unused.
- `Branch.hours` is JSON: define and validate a Zod schema for it (open/close per weekday, closed days) and document the shape.
- Add the indexes needed for availability queries (appointments by stylist and time, by branch and time).
- Seed script: 3 placeholder branches, a believable category and service list with a couple of per-branch overrides and one branch-only service, 4-5 stylists per branch with weekly schedules and qualifications, 2-3 promotions, 2-3 membership plans, and one OWNER account whose credentials come from env vars (never hard-coded).
- Provide **separate database roles** if Neon allows on the free tier: the public site's role may only read catalog tables and insert appointments, items and customers; the staff app's role has broader rights. If not practical in v0, document it in `docs/FUTURE.md`.

## 5. Booking engine (`packages/booking`), pure and heavily tested

A framework-free TypeScript package used by both apps, with no HTTP inside it.

- `getAvailableSlots({ branchId, serviceIds, date, stylistId | 'ANY' })`: returns start times for that date in branch-local time.
- `createAppointment(...)`: performs the whole create in one database transaction and **relies on the exclusion constraint** as the final arbiter. On a constraint violation (SQLSTATE `23P01`) return a typed "slot just taken" result (and for `ANY`, retry with the next-best stylist before giving up). Never trust a client-supplied price, duration or end time: recompute everything on the server.
- **Multi-service booking** = one continuous block performed by **one** stylist who must be qualified for **all** selected services (`StaffService`). Total duration is the sum of (branch override or base) durations, plus buffer.
- **`ANY` stylist** strategy: among qualified, available stylists at that branch, choose the one with the fewest bookings that day, with a deterministic tiebreak. Record `stylistPreference` as `ANY_AVAILABLE` and the resolved `staffId`.
- A slot is available only if: the branch is open for the whole block; the stylist's `StaffSchedule` for that weekday covers the block; no `TimeOff` overlaps; no existing non-cancelled appointment overlaps (including buffer); the start is not earlier than minimum notice; the date is within the booking window.
- Put the tunable rules in **one config file** with these defaults (I will confirm with the owners; they must be trivial to change): slot granularity **30 min**, buffer between appointments **0 min**, minimum notice **120 min**, booking window **60 days**, max **3** upcoming confirmed bookings per phone number.
- Tests (Vitest) must cover at least: back-to-back bookings, exact end-equals-start, last slot of the day, a service longer than the remaining time, time off overlapping part of a slot, per-branch duration overrides, a service unavailable at a branch, an unqualified stylist, `ANY` balancing, minimum notice and window edges, timezone boundaries, and **a concurrency test where two simultaneous creates for the same slot produce exactly one success** (run against a real Postgres in CI).

## 6. Design direction (modern, not over the top)

- Generous whitespace, a neutral base, **one** strong accent colour, one display typeface paired with a clean sans (self-host the fonts; at most 2 families).
- Photography carries the design, so build clean image slots (R2 URLs, `next/image` or Cloudflare image handling, proper sizes, lazy loading, blur placeholders) and use tasteful placeholders until real photos exist.
- Motion: subtle fade-ins and soft hover states only. Respect `prefers-reduced-motion`.
- Mobile-first (most traffic is phones). Sticky "Book appointment" on mobile. Large tap targets.
- Light theme for the website. Staff app: denser and more functional, high contrast, big touch targets for tablets, shares the same tokens and fonts so it feels like the same brand.
- Brand tokens (name, colours, fonts, contact defaults) live in one config + Tailwind preset in `packages/ui` / `packages/config` so rebranding is a one-file change. Use a placeholder salon name until I supply it.
- Accessibility from day one: semantic HTML, visible focus, keyboard navigation, AA contrast, labelled form fields, meaningful alt text, accessible date/time picker, error messages tied to fields.
- Use the `frontend-design` skill if it is available to avoid generic, templated-looking output.

## 7. Security and abuse prevention (required for v0)

Because WhatsApp confirmation does not exist yet, spam defence is Turnstile plus rate limiting. Implement all of this:

- **Cloudflare Turnstile** on the booking form (verified server-side), and on staff login.
- **Rate limiting** (KV-backed, with TTL counters) on the booking-create endpoint: per IP (e.g. 5 attempts per minute) and per phone number (e.g. 3 per hour). Tighter limits on state-changing endpoints than on read pages. Return `429` with a generic message and log it.
- **Staff login**: lock out after 5 failed attempts per email+IP in 15 minutes; generic error messages; short session lifetime; secure, httpOnly, sameSite cookies.
- **Validation**: Zod on every input; phone normalised to E.164 (default country India `+91`); reject past dates, invalid service/stylist combinations and anything outside the booking window; never trust client-side checks.
- **Honeypot** field and **Origin/Referer check** on state-changing requests.
- Max upcoming bookings per phone (config above) to limit slot-blocking.
- **Security headers** via middleware: CSP (compatible with Turnstile, Sentry, Cloudflare analytics and fonts), `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`, HSTS.
- Authorization checks on **every** staff-side query, scoped by role and branch from the session. Add tests proving a receptionist at branch A cannot read or modify branch B data.
- Secrets only via environment variables or Cloudflare secrets. No secrets in client bundles.
- Don't log phone numbers or names in plain error logs or Sentry payloads (scrub PII).
- Note the residual risk (a bot that passes Turnstile can auto-confirm a real slot) in `docs/SECURITY.md`, together with the post-launch plan: WhatsApp confirm-tap with auto-release.

## 8. Performance and reliability

- Content pages (home, branches, services, offers, legal) are **static or ISR-cached** and served from the CDN. Only availability and booking endpoints are dynamic.
- Target Lighthouse **90+** on public pages (mobile). Minimal third-party scripts; no layout shift.
- Graceful failures: if the database or an API call fails, the customer sees a friendly "please try again or call the branch" message, never a stack trace. Add `error.tsx` and `not-found.tsx` boundaries.
- Availability queries must be indexed and fast; add a basic load test (k6 or autocannon script) for the availability and booking endpoints.
- Keep database connections pooled (Neon pooled connection string for runtime, direct URL for migrations only).

## 9. SEO

Per-page metadata and Open Graph tags, `sitemap.xml`, `robots.txt`, canonical URLs, and **`LocalBusiness` JSON-LD per branch** (address, geo, hours, phone). Staff app: `noindex` everywhere.

## 10. Repository layout

```
salon/
  apps/
    web/        customer website
    staff/      staff web app (PWA)
  packages/
    db/         Prisma schema, migrations, client, seed
    booking/    availability + booking engine (pure TS) and its tests
    ui/         design tokens, shared components
    config/     eslint, tsconfig, tailwind preset, site/brand config
  docs/
    schema.prisma  architecture-plan.md  DECISIONS.md  FUTURE.md  SECURITY.md  DEPLOYMENT.md
  CLAUDE.md
  .github/workflows/ci.yml
```

Create a **`CLAUDE.md`** at the repo root summarising: the stack, commands (dev, build, test, lint, db migrate/seed), the rule that all booking logic lives in `packages/booking`, that money is paise, that times are UTC with branch-timezone interpretation, the out-of-scope list, and the security rules above. Keep it short and accurate, and update it as the project evolves.

Both apps import `packages/db` and `packages/booking`. They never call each other's APIs. Migrations run only from `packages/db` (via CI or a manual command), never on app start.

## 11. Milestones

**M0: Foundation.** Monorepo, TypeScript strict, ESLint/Prettier, Tailwind preset and design tokens, shared UI primitives, CI workflow, `CLAUDE.md`, `.env.example` files, hello-world deploy config for both apps (verify the OpenNext/Cloudflare build works and fits limits, and report early if it does not).

**M1: Database.** Schema finalised, migrations (including `btree_gist` and the exclusion constraint), Zod schema for branch hours, seed script, `db:create-staff` script, local Postgres via Docker Compose for dev and CI.

**M2: Booking engine** with the full test suite from section 5, including the concurrency test. **Stop here for my review.**

**M3: Customer website, content pages.** Layout and header (with both buttons), home, branches, services with the branch switcher and cookie, offers and memberships, legal pages, SEO and JSON-LD, images, accessibility pass.

**M4: Booking flow and public API.** Multi-step flow, availability endpoint, create endpoint, Turnstile, KV rate limiting, honeypot, confirmation page, `.ics` download, error states, Playwright test for the happy path and the slot-taken path.

**M5: Staff app.** Auth and roles, today and calendar views, booking actions, walk-ins, client lookup, polling updates, audit log, password-reset flow, PWA manifest. Playwright test: **book on the website, then confirm it appears in the staff app** and that cross-branch access is denied.

**M6: Hardening and launch prep.** Security headers and CSP, remaining rate limits, Sentry, uptime and analytics hooks, load test, Lighthouse and axe checks, backups plan (Neon point-in-time recovery window plus a scheduled export script), `docs/DEPLOYMENT.md` (Cloudflare projects, domains, env vars and secrets, preview vs production, rollback, Turnstile and R2 setup), `docs/SECURITY.md`, and a launch checklist.

## 12. Reference files

I will place these in `docs/` before you start: `schema.prisma` (reference data model) and `architecture-plan.md` (stack and security plan), and the proposal PDF. If any is missing, say so in your plan and proceed from this brief. Where this brief and those files disagree, **this brief wins**, because it reflects the latest decisions (WhatsApp deferred, Cloudflare hosting, promotions page added, instant confirmation).

## 13. Definition of done for v0

- A customer on a phone can find a branch, see its hours and prices, book a service with a chosen or "any available" stylist, and see an instant confirmation, in under 2 minutes.
- The same booking appears in the staff app within about 20 seconds, on the correct stylist's column.
- Two people trying to book the same slot at the same moment cannot both succeed (proven by test).
- Role and branch scoping is enforced server-side and tested.
- Lint, type-check, unit, e2e and build all pass in CI; Lighthouse mobile is 90+ on public pages; no secrets in the repo.
- `docs/DEPLOYMENT.md` lets me deploy both apps to Cloudflare and Neon without guessing.

Begin with the plan (section 0, step 1).
