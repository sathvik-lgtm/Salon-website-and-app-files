# Future work

- WhatsApp confirm-tap with auto-release (post-launch spam defence).
- Admin CRUD screens for services, prices, schedules, promotions, memberships (first post-launch milestone).
- TOTP 2FA for OWNER / BRANCH_MANAGER (if not done in v0).
- Separate DB roles for public site vs staff app (if not practical on Neon free tier).
- Booking engine: verify the Prisma `$transaction` + advisory lock path against a real Neon pooled connection (tested locally on Postgres 17 only). Add a Neon-backed smoke test when a Neon project exists.
- Booking engine: if buffer > 0 is adopted, consider storing buffer inside `endAt` (or a second range column) so the DB constraint enforces it under races too.
- Booking engine: allow staff to override `windowDays`/notice when rescheduling (M5), and a reschedule operation that keeps the same overlap guarantees.
