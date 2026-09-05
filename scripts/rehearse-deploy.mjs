/**
 * Rehearse a deploy against a real PostgreSQL before it goes anywhere near the
 * client.
 *
 * Everything that has taken this site down has been a PostgreSQL-specific
 * failure at boot: a refused schema change, and a query returning a type Prisma
 * could not deserialize. Neither can happen on SQLite, so neither showed up
 * locally. This runs the exact production boot sequence — the same scripts, in
 * the same order — against a scratch PostgreSQL database.
 *
 *   npm run db:rehearse
 *
 * Needs a throwaway database in REHEARSAL_DATABASE_URL (in .env). See
 * DEPLOY.md, "Rehearsing a deploy", for where to get one.
 *
 * It rehearses both situations that occur in the wild:
 *
 *   1. an empty database    — a new environment: migrations create everything
 *   2. a database built by  — what production was before migrations: the
 *      `db push`              release step must baseline it, not replay
 *
 * The scratch database is wiped at the start of each. That is why it refuses to
 * run against anything that looks like production.
 *
 * Inspection goes through psql rather than @prisma/client on purpose: importing
 * the client locks the query-engine DLL on Windows, and this script has to
 * regenerate that client as it switches provider.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";

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

const fileEnv = loadEnvFile(".env");
const url = process.env.REHEARSAL_DATABASE_URL || fileEnv.REHEARSAL_DATABASE_URL || "";
const prodUrl = process.env.PROD_DATABASE_URL || fileEnv.PROD_DATABASE_URL || "";

if (!url) {
  console.error(
    "\nREHEARSAL_DATABASE_URL is not set.\n\n" +
      "Add a throwaway PostgreSQL to .env (git-ignored):\n" +
      '  REHEARSAL_DATABASE_URL="postgresql://postgres:pass@localhost:5432/wberp_rehearsal"\n\n' +
      "See DEPLOY.md, 'Rehearsing a deploy'.\n"
  );
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("\nThe rehearsal database must be PostgreSQL — that is the whole point.\n");
  process.exit(1);
}

// This script wipes the database it is given. Make it impossible to point at
// the client's data by accident.
const host = (u) => u.replace(/^.*@/, "").replace(/\?.*$/, "");
if (prodUrl && host(url) === host(prodUrl)) {
  console.error("\nThat is the production database. The rehearsal wipes what it is given — refusing.\n");
  process.exit(1);
}
if (/rlwy\.net|railway\.internal/i.test(url) && !/rehears|scratch|staging|test/i.test(url)) {
  console.error(
    "\nThat looks like a live Railway database and is not named as a scratch one.\n" +
      "Name the database something with 'rehearsal', 'staging' or 'test' in it, to be sure.\n"
  );
  process.exit(1);
}

/** psql ships with PostgreSQL but is not always on PATH on Windows. */
function findPsql() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return "psql";
  } catch {
    /* look in the usual place */
  }
  const roots = ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).sort().reverse();
    for (const v of versions) {
      const p = `${root}/${v}/bin/psql.exe`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const PSQL = findPsql();
if (!PSQL) {
  console.error("\npsql was not found. Install the PostgreSQL client tools, or add them to PATH.\n");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url };
const step = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });
const quiet = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", env });
// No shell here: the psql path contains spaces on Windows, and execFileSync
// passes arguments directly, which handles that correctly. npx still needs one.
const sql = (statement) =>
  execFileSync(PSQL, [url, "-t", "-A", "-c", statement], { encoding: "utf8" }).trim();

const wipe = () => sql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
const state = () => ({
  tables: Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")),
  history:
    Number(
      sql(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'"
      )
    ) > 0,
});

/** The connection string carries a password; never let it reach the log. */
const redact = (t) => String(t || "").split(url).join(`postgresql://****@${host(url)}`);

console.log(`Rehearsing against ${host(url)}`);
try {
  console.log(sql("SELECT version()").split(",")[0]);
} catch (err) {
  console.error(`\nCould not connect to ${host(url)}.\n`);
  console.error(redact(err.stderr || err.message).split("\n")[0]);
  console.error(
    "\nCheck REHEARSAL_DATABASE_URL in .env — the user, the password, and the port.\n" +
      "With more than one PostgreSQL installed the ports differ; each version's\n" +
      "postgresql.conf names its own.\n"
  );
  process.exit(1);
}

// The provider must be PostgreSQL for the whole rehearsal.
const schemaPath = "prisma/schema.prisma";
const original = readFileSync(schemaPath, "utf8");
writeFileSync(schemaPath, original.replace(/provider = "sqlite"/, 'provider = "postgresql"'));

let failed = false;
try {
  quiet("npx", ["prisma", "generate"]);

  const scenarios = [
    ["a new, empty database", false],
    ["a database built by db push, as production was", true],
  ];

  for (const [label, prePush] of scenarios) {
    console.log(`\n${"=".repeat(66)}\n  ${label}\n${"=".repeat(66)}`);
    wipe();

    if (prePush) {
      console.log("  (setting it up with db push first, with no migration history)\n");
      quiet("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"]);
      const before = state();
      console.log(`  before: ${before.tables} tables, migration history: ${before.history}\n`);
    }

    console.log("--- the boot sequence, exactly as the host runs it ---");
    step("node", ["scripts/db-release.mjs"]);
    step("node", ["prisma/seed.mjs"]);

    const after = state();
    console.log(`\n  after: ${after.tables} tables, migration history: ${after.history}`);
    if (!after.history) {
      console.error("  FAIL — the database is not under migration control afterwards.");
      failed = true;
    }
    if (after.tables < 30) {
      console.error(`  FAIL — only ${after.tables} tables; the schema did not apply.`);
      failed = true;
    }
  }

  // A second release must be a no-op, the way a redeploy is.
  console.log(`\n${"=".repeat(66)}\n  deploying again, with nothing changed\n${"=".repeat(66)}`);
  step("node", ["scripts/db-release.mjs"]);
  const again = state();
  console.log(`\n  after: ${again.tables} tables, migration history: ${again.history}`);
  if (!again.history || again.tables < 30) {
    console.error("  FAIL — a repeat deploy did not leave the database intact.");
    failed = true;
  }

  // The path every deploy takes from now on: the database is already under
  // migration control, and a newly written migration has to be applied.
  // Rehearse it by forgetting the most recent one, so there is something pending.
  const written = readdirSync("prisma/migrations").filter((d) => /^\d+_/.test(d)).sort();
  if (written.length > 1) {
    const newest = written[written.length - 1];
    console.log(`\n${"=".repeat(66)}\n  an established database receiving a new migration\n${"=".repeat(66)}`);

    // Build the database at the *previous* migration, so the new one has real
    // work to do. Simply forgetting the history row would leave the schema
    // already changed, and the migration would fail on its own success.
    wipe();
    const live = `prisma/migrations/${newest}`;
    const parked = `prisma/.parked-${newest}`;
    renameSync(live, parked);
    try {
      console.log(`  (building the database without ${newest})\n`);
      quiet("npx", ["prisma", "migrate", "deploy"]);
    } finally {
      renameSync(parked, live);
    }
    const before = state();
    console.log(`  before: ${before.tables} tables, history: ${before.history}\n`);

    step("node", ["scripts/db-release.mjs"]);

    const applied =
      Number(
        sql(
          `SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name = '${newest}' AND finished_at IS NOT NULL`
        )
      ) > 0;
    const end = state();
    console.log(`\n  after: ${end.tables} tables, ${newest} applied: ${applied}`);
    if (!applied) {
      console.error("  FAIL — the pending migration was not applied.");
      failed = true;
    }
    if (end.tables < 30) {
      console.error(`  FAIL — only ${end.tables} tables after applying it.`);
      failed = true;
    }
  }
} catch (err) {
  console.error("\nThe rehearsal failed — this is what would have happened on the live site.\n");
  console.error(redact(err.stdout));
  console.error(redact(err.stderr || err.message));
  failed = true;
} finally {
  writeFileSync(schemaPath, original);
  try {
    quiet("npx", ["prisma", "generate"]);
  } catch {
    console.error("\nNote: could not regenerate the local Prisma client. Run `npx prisma generate`.");
  }
}

console.log(
  failed
    ? "\nREHEARSAL FAILED — do not deploy.\n"
    : "\nRehearsal passed: fresh, pushed, redeployed, and a new migration applied.\n"
);
process.exit(failed ? 1 : 0);
