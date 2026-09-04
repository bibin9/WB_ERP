/**
 * Take an off-platform logical backup of the hosted PostgreSQL database.
 *
 * Railway's own scheduled snapshots protect against data loss inside Railway.
 * This covers what they cannot: a lost or suspended Railway account, and
 * restoring a single table without rolling the whole volume back.
 *
 * Produces a pg_dump custom-format file, which can be restored whole or
 * selectively (pg_restore --table=...).
 *
 *   npm run db:backup
 *
 * Needs PROD_DATABASE_URL in .env — see DEPLOY.md, "Querying the hosted database".
 *
 * WARNING: the output contains live employee data — passport and Emirates ID
 * numbers, salaries, IBANs. Keep it encrypted, off the repo, and delete copies
 * you no longer need.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const OUT_DIR = process.env.BACKUP_DIR || "backups";
const KEEP = Number(process.env.BACKUP_KEEP || 14); // local copies to retain

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = { ...loadEnvFile(".env.production.local"), ...loadEnvFile(".env") };
const url = process.env.PROD_DATABASE_URL || fileEnv.PROD_DATABASE_URL || "";

if (!url) {
  console.error(
    "\nPROD_DATABASE_URL is not set.\n\n" +
      "Add it to .env (git-ignored):\n" +
      '  PROD_DATABASE_URL="postgresql://user:pass@host:port/railway"\n\n' +
      "Railway -> Postgres service -> Variables -> DATABASE_PUBLIC_URL.\n"
  );
  process.exit(1);
}
if (/\.railway\.internal/i.test(url)) {
  console.error("\nThat is Railway's internal url; it does not resolve from here.\nUse DATABASE_PUBLIC_URL instead.\n");
  process.exit(1);
}

// pg_dump ships with the PostgreSQL client tools; it is not part of Node or Prisma.
const probe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
if (probe.error) {
  console.error(
    "\npg_dump was not found on this machine.\n\n" +
      "Install the PostgreSQL client tools, then re-run:\n" +
      "  Windows  winget install PostgreSQL.PostgreSQL.17\n" +
      "           (or the installer from postgresql.org - you only need Command Line Tools)\n" +
      "  macOS    brew install libpq && brew link --force libpq\n" +
      "  Ubuntu   sudo apt install postgresql-client\n\n" +
      "Railway's scheduled snapshots still protect the data meanwhile - this script\n" +
      "adds the off-platform copy. See BACKUP.md.\n"
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16); // 2026-09-04T14-32
const outFile = path.join(OUT_DIR, `wb-erp-${stamp}.dump`);
const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");

console.log(`${probe.stdout.trim()}`);
console.log(`Backing up  ${host}  ->  ${outFile}`);

const res = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", outFile, url],
  { stdio: ["ignore", "inherit", "inherit"] }
);

if (res.status !== 0) {
  console.error(`\npg_dump failed (exit ${res.status}). Nothing was written.\n`);
  process.exit(1);
}

const bytes = statSync(outFile).size;
if (bytes < 1024) {
  console.error(`\nBackup is suspiciously small (${bytes} bytes) - treat it as failed and investigate.\n`);
  process.exit(1);
}
console.log(`Done: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

// Keep the last N dumps locally; older ones should already be in your off-site copy.
const dumps = readdirSync(OUT_DIR)
  .filter((f) => f.startsWith("wb-erp-") && f.endsWith(".dump"))
  .sort()
  .reverse();
for (const old of dumps.slice(KEEP)) {
  unlinkSync(path.join(OUT_DIR, old));
  console.log(`Pruned old backup: ${old}`);
}

console.log(
  `\nRestore (whole database):\n` +
    `  pg_restore --clean --if-exists --no-owner -d "<target-url>" "${outFile}"\n` +
    `Restore one table:\n` +
    `  pg_restore --data-only --table=Employee -d "<target-url>" "${outFile}"\n` +
    `\nThis file contains live employee data. Store it encrypted and off this machine.\n`
);
