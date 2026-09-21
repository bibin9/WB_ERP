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

## UAT and production

Two permanent copies of the system in one Railway project, as two **environments**.
Every phase goes through the first before it reaches the second.

```
 phase work            phase-2, phase-3 ...            C:\Bibin\wb-erp-phase2
      |
      |  ready for the client to test:   git push origin phase-2:uat
      v
 uat branch  ------>  Pre-Prod environment      wberp-pre-prod.up.railway.app
      |
      |  client signs off:   fast-forward main to uat
      v
 main branch ------>  production environment    the client's live system
```

**Four rules the setup is built around.**

1. **Separate environments share nothing but the project.** Each environment has its own
   Postgres, its own volumes and its own variables, and a reference such as
   `${{Postgres.DATABASE_URL}}` resolves inside its own environment — so Pre-Prod cannot
   reach production's database through one. The one thing they do share is project
   membership: anybody added to the project can see both. Add only people who are also
   trusted with production.
2. **Production receives only what Pre-Prod tested.** Promotion is a fast-forward of
   `main` to `uat`. If production has anything Pre-Prod never had, git refuses.
3. **Pre-Prod is never refreshed from a production holding real data.** It was created
   by duplicating production on 16 September 2026, while production held only dummy data.
   Once the client's passports, salaries and IBANs are in production, a duplicate would
   copy them — so from then on, Pre-Prod is refreshed from test data only.
4. **No secret is shared:** its own `AUTH_SECRET`, its own administrator password, its own
   database password, no live mail settings.

> You type every password and secret into Railway yourself. None of them should ever be
> pasted into a chat — including with me. Screenshot variable **names**, never values.

---

### One-time setup — as it was actually done

#### Step 1 — Put phase 2 on GitHub as `uat`

From `C:\Bibin\wb-erp-phase2`:

```bash
git push origin phase-2:uat
```

`phase-2` keeps no upstream, so a bare `git push` from that folder still fails. There are
no GitHub Actions, and production follows `main`, so nothing else happens on the push.
**Ignore GitHub's "create a pull request" link** — a pull request into `main` is exactly
how untested work would reach production.

#### Step 2 — Duplicate production as Pre-Prod

Railway → the project → environment menu → **duplicate** production → name it **Pre-Prod**.
Nothing deploys yet: Railway holds every change until **Deploy**, so make all of Steps 3–4
first and deploy once.

**What duplicating copies — and what that means:**

| Copied | Consequence |
|---|---|
| The database, **with its data** | Every production user and password comes too. `ADMIN_PASSWORD` is ignored — it only sets the password when the administrator is first created. |
| The migration history | The first deploy applies only the migrations production has not seen — a real rehearsal of the promotion |
| Every variable, **including `AUTH_SECRET`** | Must be changed: Pre-Prod has production's user IDs, so a shared secret would let a Pre-Prod sign-in be accepted by production |
| The source branch (`main`) | Must be changed to `uat` |
| Saved mail settings | Unreadable once `AUTH_SECRET` changes, so Pre-Prod cannot send — which is what you want |

#### Step 3 — WB_ERP → Variables (check the top bar says **Pre-Prod**)

| Variable | Do this |
|---|---|
| `DATABASE_URL` | **⋮ → Edit** must show `${{Postgres.DATABASE_URL}}` |
| `AUTH_SECRET` | **⋮ → Edit** → a new value: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"` |
| `NEXT_PUBLIC_DEMO_LOGIN` | delete it if present |
| `PRISMA_PROVIDER` | leave as `postgresql` |

Showing a variable in the **Edit** box shows its template; the **eye** icon shows the
value it resolves to. Being in the list is not the same as being changed — check the new
value is really there.

#### Step 4 — WB_ERP → Settings → Source → Branch → **`uat`**

Leave **Auto deploys when pushed to GitHub** on and **Wait for CI** off.

#### Step 5 — Deploy, and read the log

Expected, because the database already has production's history:

```
Prisma provider already "postgresql"
Applying migrations.
Applying migration `20260914112837_add-stock`        (one line per new migration)
All migrations have been successfully applied.
Seeded tenant, companies, ...
Login:  admin@wandb.ae  (password as set in ADMIN_PASSWORD — not printed)
✓ Ready
```

`npm warn config production` is shown in red by Railway but is only a notice. If the
`Login:` line shows a password, the branch is not `uat`.

Then switch to **production** and check its branch still says `main`.

#### Step 6 — Get into the administrator account

Pre-Prod's administrator has production's current password. If that is not to hand, do
not guess: **three wrong attempts lock the account for 15 minutes**, and a locked account
refuses even the right password. Set a new one instead, in Pre-Prod's database:

1. `npm run user:password-sql` — type the new password twice (12+ characters). **Save it
   in the password manager before using it.**
2. Notepad opens with two queries. **Copy from Notepad, not from the terminal** — a
   terminal wraps long lines, and copying a wrapped line can put a break into the text.
3. Pre-Prod → **Postgres → Database → Data**: run query 1 (the `UPDATE`). This box shows
   **"0 rows" for any update** — that is normal, not a failure.
4. Run query 2. It must say **`hash intact`**.
5. Sign in, **typing** the password — clear anything the browser filled in first.

The same tool works for any user in any environment. It connects to nothing; which
database it changes is decided by where the statement is pasted.

#### Step 7 — Give Pre-Prod its own database password

A duplicate has production's database password. Change it before Pre-Prod is ever given
public access.

1. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` — save it.
2. **Postgres → Database → Data**: `ALTER USER postgres WITH PASSWORD 'the-new-password';`
3. **Postgres → Variables**, each via **⋮ → Edit**:

   | Variable | Value |
   |---|---|
   | `POSTGRES_PASSWORD` | the new password |
   | `PGPASSWORD` | `${{POSTGRES_PASSWORD}}` |
   | `DATABASE_URL` | `postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{PGDATABASE}}` |

4. **Deploy — and then redeploy WB_ERP too** (Deployments → ⋮ → Redeploy). Skipping
   this is what produces *"Application error: a server-side exception has occurred"*:
   the app is still running with the old password, and Postgres's restart dropped the
   connections it had.
5. Check WB_ERP's log shows `No pending migrations to apply` and `✓ Ready`.

#### Step 8 — Load the test data (from this PC)

The server is Node 20; the loader needs 22.6, so it runs here, over the internet.

1. Pre-Prod → **Postgres → Settings → Networking → Public Access** → on.
2. **Postgres → Database → Connect → Public Network** → copy the connection URL. It must
   start `postgresql://postgres:` and contain **no `${{`** — that would be the template
   from the Edit box, not the address.
3. In `C:\Bibin\wb-erp-phase2\.env`: `UAT_DATABASE_URL="<paste>"`
4. **Stop the local dev server** (`localhost:3001`). It holds a file Prisma must replace,
   and the load fails with `EPERM … query_engine` otherwise.
5. Run the loader **with `node` directly** — in PowerShell, `npm run … --` can drop the
   arguments after the `--`:

   ```bash
   node scripts/demo-data-uat.mjs
   ```

   It prints the database's host and port and the exact command to confirm with. Check the
   host matches Public Access, then run that command on one line.
6. **It takes about 45 minutes** — every receipt and issue is a few dozen round trips
   to Railway, roughly ten seconds each. It prints nothing during long stretches.
   Interrupting is safe: the next run clears what it wrote first.
7. When it prints `Wrote 459 rows of test data`: **turn Public Access off**, and start the
   dev server again if you want it.

Loaded on 16 September 2026 and checked: trial balance 0.00, 159 of 167 movements
with a voucher (the other 8 are transfers, which post none), no negative stock, all
seven quotation statuses and all eight pipeline stages present, all in **WBE**.

#### Step 9 — Logins for the testers

**Users & Roles** → one user per person, on the role they actually do. Nobody tests as the
administrator: a screen that works for Group Admin can still be refused to the storekeeper,
and finding that is what UAT is for.

#### Still to do on production

Production's **database password** is the one Pre-Prod was created with, and it was shared
in a chat on 16 September 2026. Production has no public access, so it cannot be reached
from the internet with it — but change it with Step 7's procedure, **including the WB_ERP
redeploy**, before real client data goes in.

---

### Everyday: putting work in front of the client

When a set of changes is ready for the client to test, from `C:\Bibin\wb-erp-phase2`:

```bash
git push origin phase-2:uat
```

Pre-Prod redeploys on its own and applies any new migrations. `uat` is only ever pushed from
phase 2, so it never has anything phase 2 lacks. If git ever answers
*"rejected (non-fast-forward)"*, somebody pushed to `uat` from somewhere else: run
`git fetch origin` and `git merge origin/uat`, check what arrived, then push again.

**UAT is promoted as a whole.** If a later phase starts while an earlier one is still being
tested, push it to `uat` only once you are content for both to reach production together.

---

### Promoting UAT to production

Work through these in order. Each one exists because skipping it has a specific cost.

The current release (September 2026) takes production from `fe0667a` to the signed-off
`uat` commit: phase 2 (CRM, Inventory, printed documents, reports), the performance work,
the security review fixes and the company filters. **17 migrations**, every one additive —
new tables, new columns that are either optional or have a default, indexes and foreign
keys. None drops, renames or rewrites anything phase 1 uses.

#### Before the day

These are done once, ahead of the promotion, and each one can stop it.

1. **`AUTH_SECRET` is set on production.** Production environment → WB_ERP → **Variables**:
   the name `AUTH_SECRET` must be there with a long random value. Look at the name only —
   never copy the value into a chat, a ticket or an email. From this release the app
   **refuses to start** without a real secret, rather than falling back to one written in
   the source, so a missing variable takes production down at the promotion.

   If it is missing or short, set it now, before promoting, with a fresh value:

   ```bash
   openssl rand -base64 48
   ```

   Setting it signs everybody out once. Nothing else depends on the old value yet: the
   secret also encrypts the mail password on Settings → Email, and production has no mail
   settings until this release lands.
2. **Tally, if production uses it.** Sign in to production → Finance → Tally. The connector
   now connects only to a public address: `localhost`, a `192.168…` or `10.…` address, or
   a name ending `.local` or `.internal` is refused, because on a cloud host those lead
   into the host's own network. If it is set to one of those, Tally has to be reached
   through the office's public address or a secure tunnel before it will work again.
   Everything else is unaffected.
3. **`PROD_DATABASE_URL` is in `.env`** in `C:\Bibin\wb-erp`, for the backup in step 5
   below. Add it yourself from Railway; it is git-ignored and never pasted anywhere.
4. **Production's database password has been changed** — see *Still to do on production*
   above. It was shared in a chat, and this release is the point where real client data
   starts going in. If you change it, update `PROD_DATABASE_URL` in `.env` to match.

#### On the day

1. **Client sign-off.** Who, on which build, on what date. Pre-Prod's **Deployments** tab shows
   the commit that was tested — write it down.
2. **Read what is shipping.** From `C:\Bibin\wb-erp`:

   ```bash
   git fetch origin
   git log --oneline main..origin/uat
   ```

   The top line should be the commit the client signed off. For this release there are
   about 55 commits.
3. **Rehearse the database change.** From `C:\Bibin\wb-erp-phase2`, with it at the
   signed-off commit:

   ```bash
   git fetch origin
   MERGE_BASE_REF=origin/main npm run db:rehearse-merge
   ```

   It builds a database the way production's is, applies every migration production has
   not seen, and fails if any data went missing. It must pass. It passed on 21 September
   2026 at `a177bf3`: all 17 migrations, every phase-1 table the same count before and
   after, 28 phase-2 tables created, and the seed idempotent on restart.
4. **Know what the first boot changes**, and tell the people it affects:
   - **Chart of accounts:** two accounts are added to each company's chart where missing —
     2250 Goods Received Not Invoiced and 5200 Site Materials. The stock ledger posts to
     them.
   - **Built-in roles gain the phase-2 screens their defaults include**, once. Production's
     seed used to rewrite every built-in role on each boot, so it has never recorded what
     was applied; this boot adds the defaults each role is missing, and prints each grant
     in the deploy log as `<role>: granted …`. From then on, changes made in Access Control
     stay.

     | Role | Gains |
     |---|---|
     | Operations Manager | Inventory screens (view and approve); estimates and quotations (view) |
     | Project Manager | Inventory screens (view and create); estimates and quotations (view); **Approve in the inbox** |
     | Site Engineer / Planner | Inventory screens (view and create); **the approvals inbox, with Approve** |
     | Procurement Officer | Inventory screens (full except delete); estimates and quotations (view); **the approvals inbox, with Approve** |
     | Storekeeper | Inventory screens (view, create, edit) |
     | QA/QC & Calibration | Inventory screens (view and edit) |
     | Estimation / Sales Engineer | Estimates and quotations (view, create, edit) |

     Director, Managing Director and Group Admin (level 80 and above) already see
     everything. These are the defaults Pre-Prod has run with throughout UAT.
   - **Approvals are four-eyes.** Nobody approves a request they raised, and nobody decides
     two steps of the same one. Requests already pending on production recorded only the
     requester's name, so the name is used for those.
   - **Signing in:** passwords already set keep working; the 10-character rule applies at
     the next change. Sign-ins made before the promotion last until they expire (up to
     seven days); new ones last twelve hours, and signing out ends every session.
5. **Back up production.** From `C:\Bibin\wb-erp`: `npm run db:backup` — see BACKUP.md. The backup contains
   passports, salaries and IBANs: it stays in `backups/`, which is git-ignored, and is
   never emailed or pasted.
6. **Promote**, from `C:\Bibin\wb-erp`:

   ```bash
   git fetch origin
   git merge --ff-only origin/uat
   git push origin main
   ```

   If `--ff-only` refuses, **stop**. Production has something UAT never tested — a hotfix
   that was not merged back. Bring it into UAT (see *Hotfixes*), let the client re-check,
   and start this list again.
7. **Watch production's deploy log.** Expect `Applying migrations.`, then the 17 migrations
   by name — the last three are `role-seeded-permissions`, `query-indexes` and
   `security-hardening` — then the seed with its `<role>: granted …` lines, the login line
   **without** a password, and `✓ Ready`. If the log says `AUTH_SECRET is not set`, stop
   and go back to *Before the day*, step 1.
8. **Check it by hand.** A 200 from the site proves only that the shell rendered.
   - Sign in. Open Finance, HR, Inventory and CRM.
   - Finance → Reports → Trial Balance, for one company: debits equal credits.
   - HR & Admin → People: the **Company** filter is there, and the three tiles count
     everyone rather than the fifty on the page.
   - Approvals: pressing Approve on a request you raised is refused, and says why.
   - Sign out, then sign in again.
   - The security policy is in place, from any terminal:

     ```bash
     curl -sI https://wberp-production.up.railway.app/login
     ```

     The `content-security-policy` line carries a `'nonce-…'` value.
9. **If it has gone wrong:** production environment → WB_ERP → **Deployments** → the deployment before
   this one → **Redeploy**. The previous version boots against the newer database with
   *"No pending migrations to apply"*, because every migration in this release only adds —
   the new tables and columns stay, unused, until the fix is promoted. Two things to know:
   the older seed goes back to rewriting built-in roles on each boot, so changes made in
   Access Control after the promotion are reset by the rollback; and sign-in reverts to
   the old lock-out rules until the fix is promoted.
10. **Close up.** If Public Access was turned on for the production database to take the
    backup, turn it off again. Tell the client it is live, and which build.

---

### Hotfixes

For something broken in production that cannot wait for a UAT round:

1. Fix it in `C:\Bibin\wb-erp` on `main`, run the tests, push. Production deploys.
2. Straight after, bring the fix into phase 2, from `C:\Bibin\wb-erp-phase2`:

   ```bash
   git fetch origin
   git merge origin/main
   ```

3. Put it into UAT with your **next normal push** to `uat` — not before, if phase 2 has
   work in it that is not ready for the client. A hotfix is no reason to put half-finished
   work in front of testers.

Until UAT has the fix, promotion is refused by `--ff-only`. That refusal is on purpose:
a UAT without the fix must not replace a production that has it.

---

### Living with UAT

- **Email.** Leave **Settings → Email** unset in UAT unless you are testing sending, and
  then point it at a test mailbox — never the live Outlook. The test customers' `.test`
  addresses deliver nowhere, but an address a tester types in is real.
- **Remove the test data:** `node scripts/demo-data-uat.mjs --confirm-host=<host:port> --clean`
- **The enquiry page that returns 500 locally** works on UAT. That crash belongs to the
  development server on Windows, not the application.

### If something goes wrong

| What you see | What it means |
|---|---|
| `EPERM: operation not permitted, rename ... query_engine` | The local dev server is still running. Stop it, run the loader again. |
| `You confirmed ..., but the database this is pointed at is ...` | `UAT_DATABASE_URL` in `.env` is not the database you think. Copy it again. |
| `UAT_DATABASE_URL points at production` | It is production's database. Do not work round this. |
| `! [rejected] phase-2 -> uat (non-fast-forward)` | Something was pushed to `uat` from outside phase 2. `git fetch origin`, `git merge origin/uat`, check it, push again. |
| `fatal: Not possible to fast-forward, aborting.` during promotion | Production has a change UAT never tested — usually a hotfix not yet pushed to `uat`. See *Hotfixes*. |
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
