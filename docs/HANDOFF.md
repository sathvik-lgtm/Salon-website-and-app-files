# Handoff — read this first in a new chat

Last updated: 2026-11-01 (end of M3). Full spec: `docs/BRIEF.md` (the owner's build brief; it wins over everything else).
Decisions so far: `docs/DECISIONS.md`. Rules/commands: `CLAUDE.md`.

## Working agreement (from the brief, section 0)
- Build milestone by milestone (M0..M6). At the end of each: lint, typecheck, tests, build, commit, push, then a summary of 10 lines or fewer.
- The mandatory stop after M2 is done and the owner approved it. Continue milestone to milestone unless blocked. **M4 IS BLOCKED on one owner decision: see "Decision needed" below.**
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

- **M2 Booking engine** (`packages/booking`, pushed, owner-approved): pure engine behind a `BookingPort` + Prisma port. Owner-set rules in `config.ts`: 5 min grid, 20 min notice, 7-day window, max 2 per phone (staff walk-in/phone bookings exempt). 56 booking tests: in-memory port (every case in brief section 5) plus real Postgres incl. two-simultaneous-creates-one-success (made deterministic with a barrier), 10-way race, `ANY` race, phone-cap race. Mutation-checked. CI `check` job has a Postgres 17 service. Decisions at the end of `docs/DECISIONS.md`.
- **M3 Website content pages** (`apps/web`): layout with header (Book appointment + Offers & Memberships buttons), mobile menu, mobile sticky bar, footer; home; `/branches` + `/branches/[slug]` (hours table, open-now, tel link, directions link, branch services, LocalBusiness JSON-LD); `/services` + `/services/[category]` with branch switcher and `salon_branch` cookie; `/offers`; `/privacy` (with #data-deletion) and `/terms` (placeholder copy, gaps in [brackets]); `/book` is a **placeholder** (branch phone numbers, noindex) until M4; sitemap.xml, robots.txt, canonical + Open Graph, icon, 404 and error pages. All routes are static. Verified in real Chrome with a throwaway Playwright + axe-core script (181 checks: axe WCAG A/AA + best-practice on every page at 390 px and 1280 px, no horizontal scroll, one h1 per page, switcher + cookie + keyboard, menu + Escape, open-now with a forced clock and a Los Angeles visitor, JSON-LD, sitemap/robots, 404s, crawl of every internal link). That script is NOT committed: M4 should turn it into the committed Playwright suite. Lighthouse not run yet (M6).

## Decision needed from the owner before M4 (do not guess)
The booking API must reach Postgres from a Cloudflare Worker at request time. Measured on a Linux build (`bash scripts/cf-size-docker.sh web`), gzip size of the website Worker: hello-world **840 KiB**; with Prisma + its drivers bundled **3,074 KiB**; M3 as shipped (no DB code in the Worker) **1,095 KiB**. Prisma + drivers cost about 2.2 MiB gzipped, and the brief's Free-plan limit is 3 MiB (3,072 KiB). Cloudflare's docs contradict each other on that limit (see DECISIONS.md): the limits page fetched 2026-11-01 says there is no compressed limit (64 MiB uncompressed on both plans), others still say 3 MB. The Free plan's 10 ms CPU per request is the likelier problem for Prisma's engine and is untested. Options to put to the owner in plain words:
1. **Light SQL layer in the Worker (recommended).** Keep Prisma for schema, migrations, seed and CLI scripts, but run the booking port and API reads through a small driver (`@neondatabase/serverless` with plain SQL, or Drizzle, which the brief names as the fallback; tell the owner before switching). Stays on the free plan with a small bundle and little CPU. Cost: re-implement `createPrismaPort` (about 8 queries) and run the same Postgres test suite against both ports.
2. **Keep Prisma and pay.** Workers Paid is a minimum of $5 USD/month (10 million requests, 30 s CPU per request, per the pricing page fetched 2026-11-01). Least work, but changes the owner's "about 0 rupees a month" budget.
3. **Keep Prisma, stay free, and test.** Deploy a real Worker and see whether it fits and stays under 10 ms. Might work if the size limit really is gone; the CPU risk remains.
Whatever is chosen, verify with a real deploy to the owner's Cloudflare account (the only way to settle the doc conflict) before launch.

## Current state / environment
- Docker Desktop installed; engine works. The CLI is not on PATH in every shell. Add it: `C:\Users\elect\AppData\Local\Programs\DockerDesktop\resources\bin`. Postgres via `docker compose up -d` (host port **5433**, user/db `salon`). `packages/db/.env` exists locally (gitignored); copy from `.env.example`.
- DB is migrated and seeded locally. `apps/web/.env.local` (gitignored; copy of `.env.example`) must exist for the website's snapshot step.
- `pnpm cf:build` (OpenNext) **fails on this Windows PC** (symlink EPERM). Use `bash scripts/cf-size-docker.sh web` (Docker, Linux) to build and read the real gzip size locally, or CI; the repo is public so CI results are readable via `https://api.github.com/repos/sathvik-lgtm/Salon-website-and-app-files/actions/runs`. Job logs need auth, so exact gzip sizes are unknown. Re-check the 3 MiB Free-plan limit once Prisma/Auth.js are bundled (M4/M5).
- Placeholder brand name and `example.com` domain. The owner mentioned `nulooks.com` as an example landing domain but has not confirmed it as the real one; ask before replacing.
- Reference files `schema.prisma`, `architecture-plan.md` and the proposal PDF were never supplied; the schema was written from the brief.
- pnpm 12 blocks dependency build scripts by default; allowed ones are in `pnpm-workspace.yaml` (`allowBuilds`).

## Next: M4 (after the owner's decision above)
Multi-step booking flow at `/book` (replaces the placeholder; read the `salon_branch` cookie as the default branch, accept `?branch=slug`), availability endpoint, create endpoint, Turnstile, KV rate limiting (per IP and per phone), honeypot, Origin/Referer check, confirmation page with .ics download and the branch phone, error states, committed Playwright tests (happy path and slot-taken path, plus the axe checks from M3). The engine is `packages/booking`; show start times grouped by hour (a 5-minute grid is about 97 starts for a one-hour service). Brief section 11 (M4) and section 7 (security).
Then M5 staff app, then M6 hardening, Lighthouse and `docs/DEPLOYMENT.md` (include a scheduled daily redeploy so expired promotions drop off, and that content changes need a rebuild).

## Known risks to keep an eye on
- Workers Free: 10 ms CPU per request (Next + DB driver + Auth.js + PBKDF2) and, per the brief, a 3 MiB gzipped bundle (docs conflict, see above). The website is at 1,095 KiB; the staff app is not yet measured with Auth.js. If a limit fails, stop and tell the owner the cheapest paid option; do not silently change the plan.
- `next-auth` v5 is still a beta.
- Generated Prisma client (`packages/db/src/generated`) is gitignored; `pnpm install` regenerates it.
