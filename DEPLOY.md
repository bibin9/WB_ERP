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

## When you move to real production later

For a resold/production deployment (beyond this pilot):
- Move file uploads to S3-compatible object storage (Cloudflare R2 / AWS S3).
- Replace `prisma db push` with proper migrations (`prisma migrate`).
- Use a UAE region if the client needs data residency (AWS me-central-1 / Azure UAE North).
- Automated database backups + error monitoring (e.g. Sentry).
