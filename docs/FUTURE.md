# Future work

- WhatsApp confirm-tap with auto-release (post-launch spam defence).
- Admin CRUD screens for services, prices, schedules, promotions, memberships (first post-launch milestone).
- TOTP 2FA for OWNER / BRANCH_MANAGER (if not done in v0).
- Separate DB roles for public site vs staff app (if not practical on Neon free tier).
- Booking engine: verify the Prisma `$transaction` + advisory lock path against a real Neon pooled connection (tested locally on Postgres 17 only). Add a Neon-backed smoke test when a Neon project exists.
- Booking engine: if buffer > 0 is adopted, consider storing buffer inside `endAt` (or a second range column) so the DB constraint enforces it under races too.
- Booking engine: allow staff to override `windowDays`/notice when rescheduling (M5), and a reschedule operation that keeps the same overlap guarantees.
- Website: automatic content refresh (ISR) instead of redeploy-on-change: OpenNext R2 incremental cache + Durable Object queue + `WORKER_SELF_REFERENCE` binding. Worth it once admin screens exist; until then a scheduled daily redeploy is enough.
- Website: `Branch.sortOrder` column so the owner can reorder branches without relying on creation order.
- Website: real photography on R2 (branches, hero, promotions), generated Open Graph images, per-service images.
- Website: turn the M3 browser checks (axe-core on every page at phone and desktop width, switcher/cookie, menu, open-now with a forced clock, link crawl) into the committed Playwright suite in M4, and add Lighthouse in M6.
- Verify on a real deployed Worker (cannot be proven locally): the RATE_LIMIT KV binding and counters, secrets arriving through process.env, the Prisma + Neon pooled connection (interactive transaction + per-stylist advisory lock), real Turnstile keys, and CPU time per booking.
- Turnstile: also check the returned hostname (and bind an action) once the real domain exists.
- Rate limits: move counters to a Durable Object if KV's eventual consistency proves too loose.
- Online change/cancel for customers (needs a safe way to prove who they are; the schema already stores a manage-token hash).
