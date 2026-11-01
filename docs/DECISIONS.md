# Decisions

- Repo at `C:\dev\salon` (outside OneDrive) — OneDrive syncing node_modules corrupts installs.
- Prisma pinned to 7.10.1 — npm `latest` is an 8.0 release candidate; 7.x is the stable line.
- TypeScript pinned to 5.9.3 — TS 7 (native) is brand new; tooling compatibility not guaranteed.
- Tailwind v4 CSS-first tokens (`theme.css`) instead of a JS preset — v4 no longer uses `tailwind.config` presets.
- Auth.js = `next-auth@5` beta (v4 `latest` is Pages-router-oriented). Beta risk noted; revisit in M5.
- pnpm 12 blocks dependency build scripts by default; allowlisted esbuild, workerd, unrs-resolver in `pnpm-workspace.yaml`.
- OpenNext build cannot run on this Windows machine without symlink permission; size checks run in GitHub Actions (Linux).
- Placeholder brand name/domain (`example.com`) until supplied.
