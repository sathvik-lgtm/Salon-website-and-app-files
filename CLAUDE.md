# Salon platform v0

**New chat? Read `docs/HANDOFF.md` first** (history, current state, next steps). Full spec: `docs/BRIEF.md`.

Booking platform for a 3-branch salon: `apps/web` (public site) and `apps/staff` (private PWA), sharing `packages/db` (Prisma/Neon) and `packages/booking` (pure TS engine). Spec: the original build brief; decisions in `docs/DECISIONS.md`.

## Stack
pnpm workspaces + Turborepo · Next.js App Router (TS strict) · Tailwind v4 (tokens in `packages/config/src/theme.css`, brand in `packages/config/src/brand.ts`) · Prisma 7 + Neon driver adapter · Auth.js (staff only) · Zod · Vitest · Playwright · Cloudflare Workers via `@opennextjs/cloudflare`.

## Commands
- `pnpm dev` / `build` / `lint` / `typecheck` / `test` (all via turbo)
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:create-staff` — start Postgres first with `docker compose up -d`; copy `packages/db/.env.example` to `.env`
- `apps/web` pages never query the database: `scripts/snapshot.ts` copies the content into `src/generated/catalog.json` before every dev start, build and typecheck, so those need `DATABASE_URL` (copy `apps/web/.env.example` to `apps/web/.env.local`) and a migrated + seeded Postgres. Content changes need a rebuild + redeploy. Only the booking API (`apps/web/src/server`, `src/app/api`) uses `@salon/db`/`@salon/booking` at request time; keep them out of page and component code (Prisma adds ~2.2 MiB gzipped to the Worker, and client code must never import the engine: use `@salon/booking/config`).
- `pnpm db:create-staff -- --email a@b.in --name "Name" --role RECEPTIONIST --branch branch-one` creates a staff account and prints a one-time password (add `--reset` with just `--email` to reset one). `apps/staff/.env.local` (copy `.env.example`) needs `AUTH_SECRET` and `AUTH_URL`.
- `pnpm --filter @salon/staff e2e` — Playwright tests of the staff app (start both apps, need `pnpm build`, seeded Postgres, internet for Turnstile test verification).
- `pnpm --filter @salon/web e2e` — Playwright browser tests (needs `pnpm build` first, a seeded local Postgres, and internet for Turnstile's test verification). `bash scripts/cf-size-docker.sh web` measures the real Cloudflare bundle size via Docker.
- `pnpm --filter @salon/<app> cf:build` — OpenNext build. **Needs Linux/CI or Windows Developer Mode** (symlink EPERM otherwise).

## Rules
- ALL booking/availability logic lives in `packages/booking`. Apps never reimplement it; apps never call each other. Apps call `getAvailableSlots` / `createAppointment` with `createPrismaPort(db)` (from `@salon/booking/prisma`); tunable rules are in `packages/booking/src/config.ts`. Both return typed `{ ok: false, reason }` results, never throw for expected cases.
- Booking tests: `engine.test.ts` (in-memory port) and `postgres.test.ts` (real Postgres; needs `docker compose up -d`, skipped locally if no `DATABASE_URL`, mandatory in CI, localhost only).
- Staff app access control: ALL staff reads and writes go through `apps/staff/src/server/data.ts`, which takes the signed-in `Actor` (re-read from the database each request) and starts every appointment query from `appointmentScope(actor)`; the rules are in `server/access.ts` (pure, tested). Out-of-scope = NOT_FOUND, same as missing. Never query appointments or customers from a page or route directly. Stylists are read-only and never see customer phones. No middleware: every page and API route checks the person itself.
- Booking API security order lives in `apps/web/src/server/booking-api.ts` (origin, rate limits, Zod, honeypot, Turnstile, engine). Never log names, phone numbers or IPs. Online bookings need a mobile number.
- Money = integer paise (INR). Instants stored UTC; branch hours/schedules interpreted in the branch `timezone` (default Asia/Kolkata).
- No double-booking: enforced by a Postgres `EXCLUDE USING gist` constraint (all statuses except CANCELLED, NO_SHOW); SQLSTATE `23P01` = slot taken.
- Migrations run only from `packages/db`, never on app start.
- Never commit secrets; `.env.example` only. Seed data is placeholder.
- Security: Zod on every input, Turnstile + KV rate limits on booking/login, server-side role+branch scoping on every staff query, no PII in logs/Sentry.
- Out of scope for v0: notifications (WhatsApp/SMS/email), payments, POS, waitlist, recurring, reviews, analytics dashboard, customer accounts, manage/cancel page, client-notes UI (`Customer.notes` must not be read), admin CRUD screens. Put ideas in `docs/FUTURE.md`.
