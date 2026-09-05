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
