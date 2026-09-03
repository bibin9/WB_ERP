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

- **`railway.json`** tells Railway to build with `npm run build:deploy` and start with
  `npm run start:deploy`.
- **`build:deploy`** runs `scripts/use-postgres.mjs` (flips the Prisma datasource from
  `sqlite` to `postgresql` in the built image only), generates the Prisma client, then
  `next build`.
- **`start:deploy`** runs `prisma db push` (creates/updates the tables — no manual
  migration needed for the pilot), seeds initial data, then `next start`.
- **Seeding is safe to re-run:** an existing admin's password is never overwritten, and
  core data uses upserts.

## Local development is unchanged

Keep developing locally as before — SQLite, `npm run dev`. Do **not** run `build:deploy`
locally (it would rewrite the schema to Postgres). The normal `npm run build` and
`npm run dev` still use SQLite.

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
