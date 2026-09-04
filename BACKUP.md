# Backup & recovery

What is at risk, how it is protected, and how to get it back.

## What has to be backed up

The ERP keeps its data in **two separate places**, and a plan that covers only one
of them is not a plan:

| | Where it lives | What is lost without it |
|---|---|---|
| **Database** | Railway PostgreSQL volume | Every record — employees, payroll runs, journals, leave, settlements, approvals, audit trail |
| **Uploaded documents** | Railway disk volume mounted at `/app/uploads` | The actual passport, visa, Emirates ID and certificate files. The database keeps only the file *name* — the file itself is on the volume |

Deleting the uploads volume leaves the app showing documents that no longer open.

## The plan

Two layers, because they fail differently.

### Layer 1 — Railway scheduled snapshots (protects against mistakes)

Railway can snapshot a volume on a schedule. **This is not on by default — you must
turn it on**, and it must be done on **both** volumes.

For each of the **Postgres service** and the **app service** (the uploads volume):

1. Railway → the service → **Backups** tab (or Volume → Backups)
2. Add these schedules — Railway allows more than one on the same volume:

| Schedule | Runs | Kept for | Covers |
|---|---|---|---|
| **Daily** | every 24 h | 6 days | "someone deleted the wrong record this morning" |
| **Weekly** | every 7 days | 1 month | "this went wrong a fortnight ago and nobody noticed" |
| **Monthly** | every 30 days | 3 months | year-end / audit position |

Run all three. Snapshots are incremental and copy-on-write — you are billed only for
what differs, at the normal volume rate (~$0.15/GB/month), so for a database this size
the cost is a few fils a month.

### Layer 2 — Off-platform dump (protects against losing Railway itself)

Snapshots live inside Railway. If the account is suspended, billing fails, or the
project is deleted, the snapshots go with it. So keep a copy you control:

```bash
npm run db:backup
```

This writes a `pg_dump` custom-format file to `backups/` (git-ignored). Unlike a
snapshot it can be restored **selectively** — one table, without rolling the whole
volume back — and it can be restored to any Postgres anywhere.

It needs the PostgreSQL client tools installed once:

```bash
winget install PostgreSQL.PostgreSQL.17
```

Then move the file somewhere off this machine — OneDrive, Google Drive, an encrypted
external disk. A backup that only exists on the laptop that might die is not a backup.

## How often

| When | What | Why |
|---|---|---|
| Now, before client testing | Turn on all three Railway schedules, both volumes | Costs minutes, prevents the disaster |
| Before any deploy that changes the schema | `npm run db:backup` | Migrations are the single most likely cause of data loss |
| Weekly during the pilot | `npm run db:backup`, copy off-machine | Cheap insurance while data is being entered in earnest |
| Monthly once live | `npm run db:backup`, keep 12 months | Audit and year-end positions |
| Every quarter | **Test a restore** (see below) | An untested backup is a guess |

## Restoring

**From a Railway snapshot** (whole volume, back to a point in time):

1. Railway → service → **Backups** → find the timestamp → **Restore**
2. Railway stages a new volume mounted at the original path; the old one unmounts but is
   kept
3. Review the staged change, then deploy

The service redeploys, so expect a short outage. Everything written *after* that
snapshot is gone — check the timestamp before committing to it.

**From a dump** (whole database, or one table):

```bash
# everything
pg_restore --clean --if-exists --no-owner -d "<target-url>" backups/wb-erp-2026-09-04T14-32.dump

# just one table's rows
pg_restore --data-only --table=Employee -d "<target-url>" backups/wb-erp-2026-09-04T14-32.dump
```

Restore into a **scratch database first** and look at it before you point it at
production. `--clean` drops existing objects.

## Testing the restore

Quarterly, and after any change to the schema:

1. Create a throwaway Postgres (a second Railway service, or a local one)
2. `pg_restore` the newest dump into it
3. Point `PROD_DATABASE_URL` at it and run `npm run db:prod`
4. Confirm employees, payroll runs and journals are all present and the counts look right
5. Delete the throwaway

## Handle with care

Backups contain **live personal data** — passport and Emirates ID numbers, salaries,
IBANs, medical records. Treat every dump as you would the HR filing cabinet:

- `backups/` and `*.dump` are git-ignored. Never commit one, never attach one to a
  ticket or email, never paste one into a chat
- Store off-machine copies encrypted (BitLocker, an encrypted drive, or a password-
  protected archive)
- Delete copies you no longer need — old dumps are a liability, not an asset
- If you hand the system to the client, the backups belong to them

## Known gaps

Worth fixing before this stops being a pilot:

1. **Uploaded documents have no off-platform copy.** Railway snapshots cover them, but
   `npm run db:backup` does not — it backs up the database only. The proper fix is
   moving uploads to object storage (Cloudflare R2 / AWS S3), which brings its own
   versioning and replication. This is already noted in DEPLOY.md.
2. **The schema is deployed with `prisma db push`, not migrations.** That is fine for a
   pilot but means there is no migration history to roll forward or back. Switch to
   `prisma migrate` before real production.
3. **Backups are manual.** Layer 2 depends on someone remembering. Once the client is
   live, run it from a scheduled task (Windows Task Scheduler) or a small cron job on a
   machine that is always on.
