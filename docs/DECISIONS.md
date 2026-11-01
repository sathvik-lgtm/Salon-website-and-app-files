# Decisions

- Repo at `C:\dev\salon` (outside OneDrive) — OneDrive syncing node_modules corrupts installs.
- Prisma pinned to 7.10.1 — npm `latest` is an 8.0 release candidate; 7.x is the stable line.
- TypeScript pinned to 5.9.3 — TS 7 (native) is brand new; tooling compatibility not guaranteed.
- Tailwind v4 CSS-first tokens (`theme.css`) instead of a JS preset — v4 no longer uses `tailwind.config` presets.
- Auth.js = `next-auth@5` beta (v4 `latest` is Pages-router-oriented). Beta risk noted; revisit in M5.
- pnpm 12 blocks dependency build scripts by default; allowlisted esbuild, workerd, unrs-resolver in `pnpm-workspace.yaml`.
- OpenNext build cannot run on this Windows machine without symlink permission; size checks run in GitHub Actions (Linux).
- Placeholder brand name/domain (`example.com`) until supplied.
- Schema written from the brief (reference `schema.prisma` was not supplied); lives at `packages/db/prisma/schema.prisma`.
- Instant columns (`startAt`, `endAt`, promo dates) are `timestamptz` — Prisma's default `timestamp` makes `tstzrange` non-immutable and breaks the exclusion constraint.
- Exclusion range is `[)` so end == next start is allowed; extra CHECK `endAt > startAt`.
- Prisma 7: datasource URL is in `prisma.config.ts` (DIRECT_URL for migrations, else DATABASE_URL); client uses a driver adapter (`neon` on Workers, `pg` locally/CI) — see `createDb`.
- Local Postgres on host port 5433 (avoids clashing with an existing local Postgres).
- Staff schedules: ISO weekday + minutes-since-midnight rows (multiple rows/day allowed for split shifts).
- A service is offered at a branch only if a `BranchService` row exists with `available = true`.
- `create-staff` prints a random one-time password and sets `mustChangePassword` (no password on the CLI, so none in shell history); `--reset` re-issues for an existing account.
- Password hashing: PBKDF2-SHA256, 100k iterations (workerd cap). CPU cost vs Free 10 ms cap to be measured on a deployed Worker in M5.
- Docker CLI is not on PATH in some shells: `C:\Users\elect\AppData\Local\Programs\DockerDesktop\resources\bin`.
