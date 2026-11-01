# Deployment guide

How to put the platform on the internet, keep it running, and get it back if something goes wrong.
Written for the owner: no step assumes you already know Cloudflare or Neon. Nothing here has been run
against a real Cloudflare account yet (see "First real deploy" at the end for what to watch).

Work through [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) alongside this: that is the "am I ready?" list,
this is the "how".

## 1. The pieces

| Piece | What it is | Where it runs |
| --- | --- | --- |
| Website | `apps/web`: the public pages and the booking API | Cloudflare Worker `salon-web`, at `https://<domain>/` |
| Staff app | `apps/staff`: the private desk app | Cloudflare Worker `salon-staff`, at `https://<domain>/admin` |
| Database | all bookings, customers, staff accounts | Neon (Postgres 17) |
| Rate-limit counters | brakes on repeated requests | Cloudflare KV namespace `RATE_LIMIT` (shared by both Workers) |
| Bot check | Turnstile on the booking form and staff sign-in | Cloudflare (free) |
| Photos | branch and promotion pictures (later) | Cloudflare R2 bucket |
| Error reports | server errors, with no personal details | Sentry (free plan) |

The two Workers share one domain. Cloudflare sends `<domain>/admin*` to the staff Worker and
everything else to the website Worker (the more specific route wins).

## 2. Accounts and what they cost

| Service | Plan | Cost | Why |
| --- | --- | --- | --- |
| Cloudflare Workers | Paid | from $5 USD/month | the Workers are too large and too CPU-hungry for the Free plan (decision of 2026-11-01) |
| Cloudflare KV, Turnstile, Web Analytics, R2 (small) | Free tiers | $0 | enough for one salon |
| Neon | Free to start; **Launch for production** | Free: $0. Launch: pay as you go | Free keeps only 6 hours of history and sleeps after 5 idle minutes (the first visitor waits for it to wake). Launch keeps up to 7 days of history and lets you turn sleeping off |
| Sentry | Developer (free) | $0 | about 5,000 errors a month, one user (check their pricing page when you sign up) |
| Uptime monitor | see section 9 | $0 to a few dollars | UptimeRobot's free plan is, per most sources, for non-commercial use only: read their terms before relying on it for a business |

Prices change: confirm each on the provider's own pricing page when you sign up.

## 3. One-time setup

Do these once, in this order. Each command is run in a terminal in the project folder
(`C:\dev\salon`). Log in to Cloudflare first: `pnpm exec wrangler login` from `apps/web`.

### 3.1 The domain

Add your domain to Cloudflare (Dashboard, "Add a domain") and point the registrar's nameservers at
Cloudflare. Wait until the dashboard says the domain is **Active**. Until the real domain exists the
code uses `https://example.com` as a placeholder in `packages/config/src/brand.ts`
(`siteUrl`, `staffUrl`); change those two lines, plus the brand name and contact details, before launch.

### 3.2 The database (Neon)

1. Create a Neon project, region closest to your customers (Mumbai if offered, otherwise Singapore).
   Use Postgres 17.
2. In the Neon dashboard, "Connect" shows two connection strings. You need both:
   - **Pooled** (host contains `-pooler`): for the running Workers. Goes in the `DATABASE_URL` Worker secret.
   - **Direct** (no `-pooler`): for migrations, the seed, the nightly website build and backups.
3. Create the tables once, from your PC, with the **direct** string:
   ```
   $env:DATABASE_URL = "<direct string>"      # PowerShell; in Git Bash: export DATABASE_URL="..."
   pnpm db:migrate
   ```
   Migrations are never run by the apps themselves.
4. Load the real branches, services and prices. `pnpm db:seed` loads **placeholder** data (fake branches,
   prices and 14 fake staff accounts), so it refuses to run against any database that is not on your own PC
   (set `ALLOW_PLACEHOLDER_SEED=yes` only for a rehearsal database). For production, enter your real data
   instead: edit a copy of `packages/db/src/seed.ts` with the real branches, services, prices and stylists
   (and remove the fake staff), or insert the rows with Prisma Studio (`pnpm --filter @salon/db studio`).
   An admin screen for this is planned (FUTURE.md).
5. Create the first OWNER login (section 8).

### 3.3 Turnstile (the bot check)

1. Cloudflare dashboard, Turnstile, "Add widget". Hostnames: your domain. Mode: Managed.
2. You get a **site key** (public) and a **secret key** (private).
3. The site key is baked into the page when the site is built (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`). The secret key
   becomes the `TURNSTILE_SECRET_KEY` Worker secret (below).
4. After launch, also add the returned-hostname check (listed in FUTURE.md).

### 3.4 The rate-limit store (KV)

```
cd apps/web
pnpm exec wrangler kv namespace create RATE_LIMIT
```
It prints an `id`. Put **the same id** in `kv_namespaces` in **both**
[apps/web/wrangler.jsonc](../apps/web/wrangler.jsonc) and
[apps/staff/wrangler.jsonc](../apps/staff/wrangler.jsonc), replacing `REPLACE_WITH_KV_NAMESPACE_ID`.
Both Workers share it; their counter names cannot clash. Skipping this on one of them is the most likely
first-deploy mistake: that Worker would deploy but have no rate limits.

### 3.5 The routes (which Worker answers which address)

Add to `apps/web/wrangler.jsonc` (replace the domain):
```jsonc
"routes": [{ "pattern": "example.com/*", "zone_name": "example.com" }]
```
and to `apps/staff/wrangler.jsonc`:
```jsonc
"routes": [{ "pattern": "example.com/admin*", "zone_name": "example.com" }]
```
Cloudflare picks the most specific matching route, so `/admin*` goes to the staff Worker and the rest
to the website. The domain needs a proxied (orange cloud) DNS record: any placeholder A record
`192.0.2.1` works when the Workers answer everything. Add `www` the same way, or redirect it to the bare domain.

### 3.6 Secrets and variables

Secrets are typed once into Cloudflare and never appear in the repository. Run these in `apps/web`, then
`apps/staff` (each command asks you to type or paste the value):

| Name | Kind | Website | Staff | Value |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | secret | yes | yes | Neon **pooled** string |
| `TURNSTILE_SECRET_KEY` | secret | yes | yes | Turnstile secret key |
| `AUTH_SECRET` | secret | no | yes | a new random value: `openssl rand -base64 32` (never reuse one from another place) |
| `SENTRY_DSN` | secret | yes | yes | the project's DSN from Sentry (optional: no DSN means no error reports) |
| `AUTH_URL` | variable | no | yes | `https://<domain>/admin/api/auth` |

```
pnpm exec wrangler secret put DATABASE_URL
```
`DB_DRIVER` must stay **unset** on Cloudflare (it then uses the Neon driver). Never set it there.

### 3.7 Photos (R2), later

Create a bucket in the dashboard (R2), connect a custom domain such as `img.<domain>`, and upload
pictures. The site does not use R2 yet, so this can wait; when it does, add that origin to `img-src`
in `packages/security/src/headers.ts` (images from anywhere else are blocked by the security policy).

### 3.8 Error reports (Sentry)

Create a Sentry project (platform: "Node.js" or "Other"), copy its DSN, and set it as the `SENTRY_DSN`
secret on both Workers. The apps report server errors with the route name and method only: no URLs with
query strings, names, phone numbers, headers or addresses (see [SECURITY.md](SECURITY.md)). Errors in the
browser are not reported (listed in FUTURE.md). In Sentry, set an alert to email you on a new error.

### 3.9 Page-view counts (Cloudflare Web Analytics), optional

Dashboard, Web Analytics, "Add a site", choose **manual / JavaScript snippet**, copy the token from the
snippet (`data-cf-beacon='{"token": "<this>"}'`). Set it as the repository variable
`NEXT_PUBLIC_CF_BEACON_TOKEN` (GitHub, Settings, Variables) and for local deploys as the environment
variable of the same name before `cf:deploy`. It is cookie-free and collects no personal information.
Choose "manual" rather than "automatic" so the counter stays out of the staff app. Then un-bracket the
matching line in the privacy page.

## 4. Deploying

### The website
```
pnpm --filter @salon/web cf:deploy
```
This builds the site (copying the content out of the database first, so `DATABASE_URL` must be set to the
**direct** string in your terminal, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the **real** site key) and uploads it.
The build needs a **Linux** machine or Windows with Developer Mode on (a Windows quirk): the GitHub
workflow `Deploy website` does it on a Linux machine, which is the easiest way (section 5).

### The staff app
```
pnpm --filter @salon/staff cf:deploy
```
with `DATABASE_URL` set (the build does not read it, but the booking engine is built from the same
packages) and the real `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The staff app is deployed by hand on purpose: it
is where customers' details live, so a person decides when it changes.

### Preview versus production
`cf:preview` builds and runs the Worker on your own PC in Cloudflare's local runtime: a free dry run with no
public address. For a rehearsal on the internet, deploy a second Worker under another name (copy the
wrangler file, change `name`, leave out `routes`): it gets a `*.workers.dev` address and its own secrets.
Use a separate Neon branch (Neon: "Branches", copy of production data or empty) so a rehearsal can never
touch real bookings.

## 5. Keeping the website fresh

The website's pages are built from the database at deploy time. So:

- **Prices, services, branch details or promotions changed?** Run the `Deploy website` workflow (GitHub,
  Actions, "Deploy website", "Run workflow"), or `cf:deploy` yourself. Until then visitors see the old content.
- **An offer's end date passes?** The nightly run of the same workflow (02:00 India time) rebuilds the pages,
  so the expired offer disappears the next night. The workflow only works once these repository secrets exist
  (GitHub, Settings, Secrets and variables, Actions): `CLOUDFLARE_API_TOKEN` (Cloudflare "Edit Cloudflare Workers"
  template; also allow KV edit), `CLOUDFLARE_ACCOUNT_ID`, `DEPLOY_DATABASE_URL` (the Neon **direct** string), and
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Until they exist it just prints a notice and does nothing.
- Booking availability is never stale: it is computed live on every request.

## 6. Rolling back

- **Code:** every deploy is a numbered version. Dashboard, Workers & Pages, the Worker, Deployments, the
  three dots next to an earlier version, "Rollback". Or `pnpm exec wrangler rollback` in `apps/web` / `apps/staff`
  and pick a version. It takes effect in seconds. Cloudflare keeps the 100 most recent versions. A rollback
  does not undo changes to the database or to secrets.
- **Database:** see section 7. Prefer fixing forward; restoring overwrites everything since that moment,
  including bookings made after it.
- **A bad migration:** migrations are written to be additive. Take a backup (`bash scripts/backup.sh`)
  immediately before running one in production.

## 7. Backups

Two independent layers, because one is never enough:

1. **Neon point-in-time restore.** Neon records every change, so you can rewind the whole database to any
   moment inside the history window: 6 hours on Free, up to 7 days on Launch (Neon pricing page, 2026-11-02).
   Console: your project, Backup & Restore, "Restore from history" (it also keeps a backup branch of what
   was there before, so a restore can itself be undone; "Time Travel" lets you look at the old data first).
   Use this for "someone cancelled everything by mistake an hour ago".
2. **A nightly encrypted export.** The `Database backup` workflow (02:47 India time) runs
   `scripts/backup.sh --verify`: it exports the database, encrypts it (AES-256), **restores it into a
   throwaway database to prove the file works**, and uploads it to a private R2 bucket. Use this for
   "Neon itself has a problem" and for anything older than the Neon window.

Setup for the nightly export:
- Create a private R2 bucket (for example `salon-backups`) and an R2 API token limited to it (Object Read & Write).
  Add an object lifecycle rule to delete files older than 30 days.
- Repository secrets: `BACKUP_DATABASE_URL` (Neon **direct** string), `BACKUP_PASSPHRASE` (a long random
  passphrase; **also store it in your password manager**, because without it the backups cannot be opened),
  `R2_ACCOUNT_ID`, `R2_BACKUP_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Run it once by hand (Actions, "Database backup", "Run workflow") and check the run is green and a file
  appeared in the bucket. A backup nobody has ever restored is only a hope, which is why every nightly run restores its own
  file into a throwaway database and fails loudly if that does not work (a red run is an email from GitHub).
  Once a quarter, also download one file from R2 and open it yourself with the commands below.

Restoring from an export: decrypt, then `pg_restore` into a **new, empty** Neon branch or database, check it,
and only then point the apps at it (change the `DATABASE_URL` secrets):
```
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in salon-<stamp>.dump.enc -out salon.dump
pg_restore --no-owner --dbname "<direct string of the new empty database>" salon.dump
```
The export holds customer names and phone numbers: it stays encrypted, is never emailed or committed
(`backups/` and `*.dump*` are git-ignored), and the passphrase never sits next to it.

## 8. Staff accounts

Create the first OWNER from your PC with the Neon **direct** string in `DATABASE_URL`:
```
pnpm db:create-staff -- --email owner@yourdomain --name "Owner Name" --role OWNER
```
It prints a one-time password **once**. Sign in at `https://<domain>/admin`; the app forces a new password
immediately. Every other account is created the same way (`--role BRANCH_MANAGER --branch branch-one`,
`RECEPTIONIST`, `STYLIST`). A forgotten password: the Team screen's "temporary password" button (owners and
branch managers), or `pnpm db:create-staff -- --email <email> --reset`.

## 9. Monitoring

- **Is it up?** Add two monitors in an uptime service (UptimeRobot, or any alternative: read the terms, the
  free plan of UptimeRobot is described by most sources as non-commercial):
  - `https://<domain>/api/health` every 5 minutes: confirms the website Worker answers. It never touches the database.
  - `https://<domain>/admin/login` every 5 minutes: confirms the staff Worker answers.
  - Optionally `https://<domain>/api/health?db=1` every 30-60 minutes: also confirms the database answers.
    **On Neon Free, do not run this more often than that**: every check wakes the database and a database that
    never sleeps uses up the free monthly compute allowance (about 100 hours; always awake is about 730).
  Send alerts to your phone (email or the service's app).
- **Errors:** Sentry emails you on a new error (section 3.8).
- **Traffic:** Cloudflare Web Analytics (section 3.9) and the Workers dashboard (requests, errors, CPU time).
- **Budget:** in Cloudflare, Billing, add a usage alert, and in Neon a usage alert.

## 10. Load and speed checks

Both run against your own PC and are part of release hygiene (CI runs them on every push):
```
pnpm build && pnpm --filter @salon/web start          # one terminal
pnpm --filter @salon/web load-test                     # another: reads + many people booking one slot
pnpm --filter @salon/web lighthouse                    # phone-sized Lighthouse on every public page
```
Do not point the load test at the live site: its rate limits will (rightly) block one machine, and it books
slots. After the first real deploy run Lighthouse against the live address
(`BASE_URL=https://<domain> pnpm --filter @salon/web lighthouse`); it is read-only.

## 11. First real deploy: what to watch

These cannot be proven on a PC; check each one and tell the next session what you saw
(they are also listed in [FUTURE.md](FUTURE.md)):

1. Both Workers deploy and **start**. The staff Worker is 4.6 MiB gzipped; Workers must start within 1 second.
   If a deploy fails with a startup or size error, stop: do not shrink anything blindly. Cloudflare's own pages
   disagree about the size limit (one says none, others 3 MB Free / 10 MB Paid); the Paid plan is assumed.
2. Rate limits really count: send 6 booking attempts in a minute from one address and see the `429`.
3. Booking works end to end with the **real** Turnstile keys (a real secret rejects the dummy token the tests use).
4. A booking made on the website shows in the staff app, and two people grabbing one slot get one booking (the
   Neon pooled connection with the transaction and per-stylist lock; `pnpm --filter @salon/web load-test` against
   a rehearsal Worker is not possible because of Turnstile and rate limits, so test by hand from two phones).
5. Staff sign-in over https: the session cookie is `__Secure-salon-staff.session`, Path `/admin`, and survives
   a page reload. Time a sign-in (password hashing is CPU-heavy on Workers): it must not error with
   "exceeded CPU".
6. The response headers are present on the live site (`curl -sI https://<domain>/` shows
   `content-security-policy`, `strict-transport-security`, ...), including on the prerendered pages, and the
   browser console shows no policy violations on `/`, `/book` and `/admin/login`.
7. Error reports arrive: temporarily visit a broken URL path that raises an error, or use Sentry's "send test
   event" check, and confirm an event appears with no personal details in it.
8. Run Lighthouse against the live address (target 90+ on phone).
9. Run `Database backup` once by hand and open the R2 bucket.
