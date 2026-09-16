# Deploying the pilot to Railway

This guide gets the ERP onto a private URL your client can test, using **Railway**
(managed container + PostgreSQL + a disk for uploaded files). It takes ~15 minutes.

Local development is unaffected — it keeps using SQLite. The **build automatically
switches the database to PostgreSQL** only when deploying (see "How it works" below).

---

## What you'll need

- The GitHub repo (already pushed): `https://github.com/bibin9/WB_ERP`
- A **Railway** account → https://railway.app (sign in with GitHub)
- A card on file (Railway's pilot usage is roughly **$5–10/month**)

> You do the account creation and paste in the settings below — I never handle your
> credentials. Every value you need is listed here.

---

## Step 1 — Create the project from GitHub

1. In Railway, click **New Project → Deploy from GitHub repo**.
2. Authorise Railway to see your repos and pick **WB_ERP**.
3. Railway starts a first build. It will likely fail until the database and variables
   are set (next steps) — that's expected.

## Step 2 — Add the PostgreSQL database

1. In the project, click **New → Database → Add PostgreSQL**.
2. Railway provisions it and exposes a `DATABASE_URL` on the Postgres service.

## Step 3 — Set environment variables on the app service

Open your **app service** (the one built from the repo) → **Variables** tab → add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — this references the Postgres service (type it exactly, including the `${{ }}`) |
| `PRISMA_PROVIDER` | `postgresql` — tells the build to compile for Postgres (a plain value, so it's available at build time when the `DATABASE_URL` reference isn't yet resolved) |
| `AUTH_SECRET` | a long random string (32+ chars). Generate one, e.g. run `openssl rand -base64 48` locally, or use any password generator |
| `ADMIN_PASSWORD` | the first-login password for `admin@wandb.ae` — **set a strong one**, not the demo value |

> If your Postgres service isn't named exactly "Postgres", use its actual name in the
> reference, e.g. `${{postgres.DATABASE_URL}}`.

## Step 4 — Add a disk for uploaded files

Employee documents are saved to a folder, so the service needs a persistent disk.

1. On the **app service**, open **Settings → Volumes → New Volume** (or the "Data" tab).
2. Set the **Mount path** to `/app/uploads`.
3. Save.

Without this, uploaded documents would be lost on every redeploy.

## Step 5 — Deploy

1. Trigger a redeploy (**Deploy** button, or push any commit — Railway auto-deploys `main`).
2. The build runs `npm run build:deploy`; on start it syncs the database schema and
   seeds the initial data (admin user, roles, demo records), then starts the app.
3. When it's live, open **Settings → Networking → Generate Domain** to get a public URL
   like `wb-erp-production.up.railway.app`.

## Step 6 — First login

1. Open the generated URL.
2. Sign in as **`admin@wandb.ae`** with the **`ADMIN_PASSWORD`** you set.
3. Top-right menu → **My Account & Password** → change it (good habit even though you set it).
4. Add the client's own users under **Users & Roles**, and share the URL + their logins.

## Step 7 (optional) — Custom domain

**Settings → Networking → Custom Domain** → add e.g. `erp.yourdomain.com` and follow the
DNS instructions. Railway provisions HTTPS automatically.

---

## How it works

- The standard **`build`** and **`start`** scripts do everything (no special Railway
  config needed):
  - `build` = `set-db-provider` → `prisma generate` → `next build`
  - `start` = `set-db-provider` → `prisma db push` (creates the tables — no manual
    migration needed for the pilot) → seed → `next start`
- **`scripts/set-db-provider.mjs`** picks the datasource provider: **PostgreSQL** when
  `PRISMA_PROVIDER=postgresql`, or a `postgres://` `DATABASE_URL`, or any `RAILWAY_*` env
  var is present; otherwise **SQLite** (local dev). Setting `PRISMA_PROVIDER=postgresql`
  on Railway guarantees the app is *built* for Postgres even before the `DATABASE_URL`
  reference resolves.
- **Seeding is safe to re-run:** an existing admin's password is never overwritten, and
  core data uses upserts.

## Local development is unchanged

Keep developing locally as before — SQLite, `npm run dev`. Do **not** run `build:deploy`
locally (it would rewrite the schema to Postgres). The normal `npm run build` and
`npm run dev` still use SQLite.

## Querying the hosted database

The pilot's data lives in the Railway PostgreSQL service. To read it from your own
machine — for reports, checks, or answering "what did the client actually enter?" —
you need the **public** connection string and a client.

### Step A — Expose the database and copy the connection string

By default Railway's database is only reachable from inside Railway. The hostname
`postgres.railway.internal` will **not** resolve from your laptop.

1. Railway → your project → the **Postgres** service.
2. **Settings → Networking → Public Network → Enable TCP Proxy** (if it is not already on).
   Railway gives you a host and port like `viaduct.proxy.rlwy.net:41234`.
3. **Variables** tab → copy **`DATABASE_PUBLIC_URL`**. It looks like:

   ```
   postgresql://postgres:LONGPASSWORD@viaduct.proxy.rlwy.net:41234/railway
   ```

Treat that string like a password — it is full access to the client's live data.
Do not paste it into chat, tickets or screenshots.

### Step B — Create a read-only user (recommended)

If you are querying rather than changing data, connect as a role that *cannot* write.
It removes the possibility of a mistyped `UPDATE` damaging live records. Run this once,
connected as the `postgres` user:

```sql
CREATE ROLE reporting WITH LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE railway TO reporting;
GRANT USAGE ON SCHEMA public TO reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting;
-- also cover tables created later
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reporting;
```

Then use the same URL with `postgres:PASSWORD` swapped for `reporting:your-password`.

### Step C — Pick a client

**Option 1 — Prisma Studio (easiest, no install).** A browser table-browser that already
understands the schema and shows relations by name rather than raw foreign keys.

1. Add the connection string to your local `.env` (git-ignored):

   ```
   PROD_DATABASE_URL="postgresql://reporting:pass@viaduct.proxy.rlwy.net:41234/railway"
   ```

2. Run:

   ```bash
   npm run db:prod
   ```

Studio opens at http://localhost:5555. Your local `DATABASE_URL` and
`prisma/schema.prisma` are untouched — the command generates a temporary
`prisma/.prod.prisma` from the real schema each time, so it can never drift, and it
refuses to run against Railway's internal hostname.

Studio is for browsing and spot edits. It does not run SQL.

**Option 2 — A SQL client (for real queries and reports).** Any Postgres client works;
**DBeaver** is free and runs on Windows. New Connection → PostgreSQL, then either paste
the URL or fill in host, port, database `railway`, and your user and password. Enable SSL
if prompted — Railway accepts it.

`psql` works too, if you have it:

```bash
psql "postgresql://reporting:pass@viaduct.proxy.rlwy.net:41234/railway"
```

### Table names

Prisma maps models to tables of the same name, quoted and case-sensitive. So they must
be double-quoted in SQL:

```sql
SELECT "empNo", name, "basicSalary" FROM "Employee" ORDER BY "empNo";
```

`SELECT * FROM employee` will fail with "relation does not exist" — the capital E matters.

A useful starting query, employees with documents expiring in the next 60 days:

```sql
SELECT c.code AS company, e."empNo", e.name, e."visaExpiry", e."passportExpiry"
FROM "Employee" e
JOIN "Company" c ON c.id = e."companyId"
WHERE e."visaExpiry" < now() + interval '60 days'
   OR e."passportExpiry" < now() + interval '60 days'
ORDER BY e."visaExpiry";
```

### Running the app itself against Postgres locally

Rarely needed, but if you want local parity with production, set a Postgres
`DATABASE_URL` in `.env` and run `npm run dev`. `scripts/set-db-provider.mjs` switches
the datasource automatically. Remember to set it back to
`DATABASE_URL="file:./dev.db"` afterwards, or the schema file stays on Postgres.

## Troubleshooting

- **Build fails on Prisma / database** → confirm `DATABASE_URL` is set to
  `${{Postgres.DATABASE_URL}}` on the app service and the Postgres plugin exists.
- **App starts but login fails** → the seed may not have run; check deploy logs for
  "Seeded tenant…". Redeploy to re-run it.
- **Uploaded files disappear after redeploy** → the volume isn't mounted at `/app/uploads`
  (Step 4).
- **Node version errors** → `.nvmrc` pins Node 20; make sure Railway isn't overriding it.

## Schema changes

The database is brought up to date at boot by `scripts/db-release.mjs`, which
decides what to do from what it finds:

| Situation | What happens |
|---|---|
| Local SQLite | `prisma db push`. Migration SQL is PostgreSQL-specific and the local database is disposable. |
| PostgreSQL, no migration history | The first release onto an existing database: push once so the schema is current, then record the migrations as already applied. This is baselining, and it happens by itself. |
| PostgreSQL, history present | `prisma migrate deploy` — apply exactly the migrations that were written and reviewed, and nothing else. |

### Why this replaced `db push` on boot

`prisma db push` used to run on every start. It decides for itself what to do to
a live database, and it refuses outright when it dislikes a change. Because it sat
in an `&&` chain ahead of `next start`, a refusal meant the server never started —
twice in one day, with a 502 for as long as it took to notice.

The refusal that caused it was a false alarm: Prisma warns about **any** new unique
constraint in case the column already holds duplicates, and the only way past it is
`--accept-data-loss`, which waves through genuinely destructive changes too. That
flag does not belong in the start script of a system holding a client's books.

### Writing a migration

After changing `prisma/schema.prisma`:

```bash
npm run db:migration -- add-cost-centres
```

That writes `prisma/migrations/<timestamp>_add-cost-centres/migration.sql`, holding
exactly the difference since the last migration. **Read it before committing.** It
warns when a migration drops something, makes a column required, or adds a unique
constraint — the shapes that can fail or lose data on a live table.

Commit the SQL together with the schema change. The two belong in the same commit:
the schema says what the code expects, the migration says how the database gets there.

### Rehearsing a deploy

Every outage this project has had was a PostgreSQL-specific failure at boot — a
refused schema change, then a query returning a type Prisma could not read.
Neither can happen on SQLite, so neither showed up in local testing.

```bash
npm run db:rehearse
```

That runs the real boot sequence — the same scripts, in the same order — against a
scratch PostgreSQL, in both situations that occur in the wild: a brand-new empty
database, and a database built by `db push` the way production was before
migrations. Then it deploys a second time to confirm a redeploy is a no-op.

It wipes the database it is given, so it refuses to run against production, against
anything sharing production's host, and against a live-looking Railway database not
named as scratch.

**Run it before every deploy that touches the schema.**

### Rehearsing a merge

`db:rehearse` answers one question: does the newest migration apply cleanly on top
of everything before it. That is the right question when one migration ships. It is
the wrong question when a branch has been running ahead for weeks, because
production has never seen any of that branch's migrations and they are about to
arrive together, on a database full of the client's data.

```bash
npm run db:rehearse-merge
```

That builds a database from `main`'s migrations only, seeds it the way production is
seeded, counts every table, applies the migrations the branch is ahead by, and counts
again. Anything that went down rather than up fails the run. It then boots the seed
twice more, because Railway restarts containers for its own reasons and a seed that
is not idempotent duplicates the chart of accounts every time.

It reads the two lists of tables out of the two schemas rather than from a list
written here, so it cannot quietly stop checking a model somebody added. Set
`MERGE_BASE_REF` to rehearse against a branch other than `main`.

Same database and same guards as `db:rehearse` — it wipes what it is given.

**Run it before merging a long-running branch.**

#### Getting a PostgreSQL to rehearse against

Either works. The second is closer to production.

**On this machine** — free, and the client tools come with it:

```bash
winget install PostgreSQL.PostgreSQL.17
createdb wberp_rehearsal
```

Then in `.env`:

```
REHEARSAL_DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/wberp_rehearsal"
```

**A second Railway database** — a couple of dirhams a month, same engine and version
as production, and it works from any machine. Add a second PostgreSQL service to the
project, name it something with `rehearsal` in it, and copy its `DATABASE_PUBLIC_URL`
into `REHEARSAL_DATABASE_URL`.

### Auto-deploy

Now that a schema change is reviewed before it ships and applied by
`migrate deploy`, auto-deploy is safe to turn back on (Settings → Source). A bad
migration fails on its own rather than stopping the server from starting.

## A UAT instance for phase 2

A second, completely separate copy of the system running the `phase-2` branch, with
test data in it, so the storekeeper, the buyer, the estimator and sales can use the new
screens before any of it goes near the client's live system. About 30 minutes, most of
it waiting for the first boot.

**Two rules the steps below are built around.**

- **A separate Railway project, not a second service inside the production project.**
  Inside one project, `${{Postgres.DATABASE_URL}}` can resolve to the *production*
  database, and one mistyped reference points UAT at the client's data. In its own
  project there is no production database for it to find.
- **The `phase-2` branch is pushed, never merged.** Production follows `main`. Pushing a
  different branch puts it on GitHub and nowhere else — there are no GitHub Actions in
  this repository, so nothing runs on the push.

> You create the accounts and type every password and secret into Railway yourself.
> None of them should ever be pasted into a chat — including with me.

### Step 0 — Check production is following `main`, then push the branch

1. Open the **production** project in Railway → the app service → **Settings → Source**.
   The branch must say **`main`**. If it says anything else, stop here.
2. On this machine, from `C:\Bibin\wb-erp-phase2`:

   ```bash
   git push -u origin phase-2
   ```

### Step 1 — A new project, with its database first

1. Railway → **New Project → Empty Project**. Name it **WB ERP UAT**.
2. **New → Database → Add PostgreSQL**.
3. Open that database → **Settings** → rename the service to **`postgres-uat`**.

The database comes first so that when the app is added it has something to point at.

### Step 2 — Add the app, on the `phase-2` branch

1. In the same project: **New → GitHub Repo → WB_ERP**.
2. Straight away: the new service → **Settings → Source → Branch** → choose **`phase-2`**.

If Railway has already started building `main` before you changed the branch, leave it —
it has no variables yet and will fail harmlessly. The next deploy uses `phase-2`.

### Step 3 — Variables on the app service

App service → **Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{postgres-uat.DATABASE_URL}}` — exactly, including the `${{ }}` |
| `PRISMA_PROVIDER` | `postgresql` |
| `AUTH_SECRET` | a **new** random value — not production's. Generate one on this machine with the command below |
| `ADMIN_PASSWORD` | a strong password for `admin@wandb.ae` — **not** production's |

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

**Why `AUTH_SECRET` must differ from production:** it signs sign-in sessions and encrypts
the saved mail server password. Shared between the two, a session from UAT could be
presented to production, and a mail password saved in one could be read by the other.

**Do not add `NEXT_PUBLIC_DEMO_LOGIN`.** It pre-fills the administrator's email and
password on the sign-in page, which is fine on a laptop and not on a URL anybody can open.

### Step 4 — Uploads disk (optional for UAT)

**Settings → Volumes → New Volume**, mount path `/app/uploads`. Without it, employee
documents uploaded during testing disappear on each redeploy — acceptable for UAT if
nobody is testing document upload.

### Step 5 — Deploy, and what a good first boot looks like

**Deploy**, then open **Deployments → View logs**. The first boot is slow — a few minutes
— because it builds the whole database at once. In order, you should see:

```
Prisma provider set to "postgresql" (railway=true, ...)
No migration history — baselining this database.
  marking 20260905114828_init as already applied    (37 of these)
Baselined. Later releases will apply migrations normally.
Seeded tenant, companies, roles, admin, ...
Login:  admin@wandb.ae  (password as set in ADMIN_PASSWORD — not printed)
✓ Ready
```

The password is deliberately **not** in the log. If you see one there, stop — the branch
deployed is not `phase-2`.

If you deployed before setting `ADMIN_PASSWORD`, the first deploy's log instead shows a
boxed *"ADMIN_PASSWORD was not set, so one was generated for this install"* with a
one-time password, and you will be asked to change it at first sign-in.

### Step 6 — Get the address and sign in

1. App service → **Settings → Networking → Generate Domain**.
2. Open it and sign in as **`admin@wandb.ae`** with your `ADMIN_PASSWORD`.
3. Check Stores, Buying and CRM open. They will be mostly empty until Step 7.

### Step 7 — Load the test data, from this machine

The test data runs here rather than on Railway: the server is built on Node 20, and the
test data needs Node 22.6, which this machine has.

1. Railway → **`postgres-uat`** → **Variables** → copy **`DATABASE_PUBLIC_URL`**.
   If it is not listed, first turn on **Settings → Networking → Public Network → Enable TCP Proxy**.
2. Open `C:\Bibin\wb-erp-phase2\.env` (git-ignored) and add a line:

   ```
   UAT_DATABASE_URL="<paste it here>"
   ```

3. **Stop the local dev server** on `localhost:3001` — Windows locks a database file the
   loader has to rebuild.
4. Run:

   ```bash
   npm run db:demo:uat
   ```

   It refuses the first time and prints the exact command to run, with the database's
   host and port filled in. Read the host, check it is the UAT database, and run what it
   printed. That confirmation is the safety catch: test data is written into a database
   only after somebody has typed which one.
5. When it finishes it puts this machine back to SQLite. Start the dev server again:

   ```bash
   npm run dev
   ```

What goes in: 4 stores and 13 bins, 24 items, 11 suppliers and customers with contacts,
four months of receipts, issues and transfers, requests and orders at every status,
RFQs with competing quotes, equipment with calibration in and out of date, returns from
site, 14 enquiries across the pipeline, 8 estimates and 7 quotations. Everything is coded
`T-…` or marked `[test data]`, and all of it lands in **WBE — WB Engineering**.

### Step 8 — Logins for the testers

**Users & Roles** → one user per person testing, on the role they actually do. Nobody
tests as the administrator: a screen that works for Group Admin can still be refused to
the storekeeper, and that is exactly what UAT is for finding.

### Living with it

- **Every push to `phase-2` redeploys UAT.** Production is not touched.
- **Email.** Leave **Settings → Email** unset in UAT unless you are testing sending. The
  test customers have `.test` addresses that deliver nowhere — but an address somebody
  types in during testing is real.
- **Remove the test data:**
  `npm run db:demo:uat -- --confirm-host=<host:port> --clean`
- **The enquiry page that 500s locally** does not on UAT. That crash belongs to the
  development server on Windows, not to the application.
- **Finished with it:** delete the WB ERP UAT project. Nothing in production depends on it.

### If something goes wrong

| What you see | What it means |
|---|---|
| `EPERM: operation not permitted, rename ... query_engine` | The local dev server is still running. Stop it and run the loader again. |
| `You confirmed ..., but the database this is pointed at is ...` | `UAT_DATABASE_URL` in `.env` is not the database you think. Copy it again. |
| `UAT_DATABASE_URL points at production` | It is the production database. Do not work round this. |
| Sign-in fails with the password you set | `ADMIN_PASSWORD` is used only when the administrator is first created. If the first deploy ran without it, use the generated one from that deploy's log. |
| First boot still going after 10 minutes | Open the log. A migration error stops there with its reason. |

## Backups

Railway's volume snapshots are **not enabled by default** and must be turned on for
both the Postgres volume and the uploads volume. Keep an off-platform copy as well
(`npm run db:backup`).

See **BACKUP.md** for the schedule, restore steps and how to test a restore.

## When you move to real production later

For a resold/production deployment (beyond this pilot):
- Move file uploads to S3-compatible object storage (Cloudflare R2 / AWS S3).
- Replace `prisma db push` with proper migrations (`prisma migrate`).
- Use a UAE region if the client needs data residency (AWS me-central-1 / Azure UAE North).
- Automated, tested database backups (see BACKUP.md) + error monitoring (e.g. Sentry).
