# Handoff — read this first in a new chat

Last updated: 2026-11-01. Full spec: `docs/BRIEF.md` (the owner's build brief; it wins over everything else).
Decisions so far: `docs/DECISIONS.md`. Rules/commands: `CLAUDE.md`.

## Working agreement (from the brief, section 0)
- Build milestone by milestone (M0..M6). At the end of each: lint, typecheck, tests, build, commit, push, then a summary of 10 lines or fewer.
- **STOP for the owner's review after M2 (booking engine).** After that continue unless blocked.
- Unspecified things: pick the simplest option, add a one-line entry to `docs/DECISIONS.md`. Out-of-scope ideas go to `docs/FUTURE.md`.
- Verify current library/Cloudflare facts from official docs instead of memory.
- The owner is a solo developer; prefer boring, low-maintenance choices. Explain things plainly; they are not deeply familiar with the tooling.

## Where things live
- Code: `C:\dev\salon` (deliberately outside OneDrive). GitHub: https://github.com/sathvik-lgtm/Salon-website-and-app-files (public, branch `main`, push directly).
- Git commits use `-c user.name=sathvik-lgtm -c user.email=guttasatvik@gmail.com` and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Done
- **M0 Foundation** (pushed): pnpm + Turborepo monorepo; `apps/web`, `apps/staff` (Next 16, Tailwind v4), `packages/{config,ui,db}`; GitHub Actions CI (`check` + `cloudflare-size` Linux job, both green).
- **M1 Database** (pushed): `packages/db` with Prisma 7.10.1 schema, migration incl. `btree_gist` + `Appointment_no_staff_overlap` exclusion constraint (verified by hand in Postgres), `branchHoursSchema` (Zod), PBKDF2 password hashing, `createDb()` (neon/pg adapters), seed (placeholder data; OWNER from `SEED_OWNER_*` env), `create-staff` CLI. 5 unit tests pass.
- **Routing decision**: staff app is served at `<domain>/admin` (Next `basePath: '/admin'`, separate Worker, Cloudflare route `domain/admin*`). Customers have no accounts/login anywhere.

- **M2 Booking engine** (`packages/booking`; **awaiting owner review, do not start M3 until they say go**): pure engine behind a `BookingPort` + Prisma port. 50 tests: 40 on an in-memory port (every case in brief section 5) and 10 on real Postgres, incl. two-simultaneous-creates-one-success (made deterministic with a barrier), 10-way race, `ANY` race, phone-cap race. Verified by mutation: tests fail if the `23P01` mapping, the busy check, the row lock or the DB constraint itself is removed. CI `check` job now has a Postgres 17 service + `pnpm db:migrate`. Decisions at the end of `docs/DECISIONS.md`.

## Current state / environment
- Docker Desktop installed; engine works. The CLI is not on PATH in every shell. Add it: `C:\Users\elect\AppData\Local\Programs\DockerDesktop\resources\bin`. Postgres via `docker compose up -d` (host port **5433**, user/db `salon`). `packages/db/.env` exists locally (gitignored); copy from `.env.example`.
- DB is migrated and seeded locally.
- `pnpm cf:build` (OpenNext) **fails on this Windows PC** (symlink EPERM). Verify Cloudflare builds in CI (Linux) instead; the repo is public so CI results are readable via `https://api.github.com/repos/sathvik-lgtm/Salon-website-and-app-files/actions/runs`. Job logs need auth, so exact gzip sizes are unknown. Re-check the 3 MiB Free-plan limit once Prisma/Auth.js are bundled (M4/M5).
- Placeholder brand name and `example.com` domain. The owner mentioned `nulooks.com` as an example landing domain but has not confirmed it as the real one; ask before replacing.
- Reference files `schema.prisma`, `architecture-plan.md` and the proposal PDF were never supplied; the schema was written from the brief.
- pnpm 12 blocks dependency build scripts by default; allowed ones are in `pnpm-workspace.yaml` (`allowBuilds`).

## Next: M2 — booking engine (`packages/booking`), then STOP for review
Pure TypeScript, no HTTP, DB injected through a small port interface. Per brief section 5:
1. Single config file (`packages/booking/src/config.ts`). Owner-set values (not the brief defaults): slot grid 15 min, buffer 0, min notice 60 min, window 7 days, max 2 upcoming online bookings per phone. (Done.)
2. `getAvailableSlots({ branchId, serviceIds, date, stylistId | 'ANY' })` returning branch-local start times (Luxon for time zones).
3. `createAppointment(...)`: one transaction; relies on the exclusion constraint; SQLSTATE `23P01` returns a typed "slot taken" result; for `ANY`, retry with the next-best stylist; recompute price/duration/end on the server; snapshot onto `AppointmentItem`; status `CONFIRMED`; random `manageTokenHash`.
4. Multi-service = one continuous block, one stylist qualified for all services (`StaffService`); branch overrides from `BranchService`.
5. `ANY` strategy: fewest bookings that day, deterministic tiebreak; record `stylistPreference = ANY_AVAILABLE` and the resolved `staffId`.
6. Vitest suite (list in brief section 5), including the **two-simultaneous-creates-one-success test against real Postgres**. Add a Postgres service to the CI `check` job for it.
7. Then summarize and wait for the owner's go-ahead.

## After M2
M3 content pages → M4 booking flow + public API (Turnstile, KV rate limits) → M5 staff app (Auth.js, roles, calendar, PWA) → M6 hardening and `docs/DEPLOYMENT.md`. Details in `docs/BRIEF.md` section 11.

## Known risks to keep an eye on
- Workers Free: 3 MiB gzipped bundle and 10 ms CPU per request (Next + Prisma + Auth.js + PBKDF2). If either fails, stop and tell the owner the cheapest paid option; do not silently change the plan.
- `next-auth` v5 is still a beta.
- Generated Prisma client (`packages/db/src/generated`) is gitignored; `pnpm install` regenerates it.
