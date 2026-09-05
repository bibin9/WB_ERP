/**
 * Bring the database up to date at deploy time.
 *
 * Replaces `prisma db push` on boot, which decided for itself what to do to a
 * live database and twice refused outright — stopping the server from starting
 * at all, because it sat in an && chain ahead of `next start`.
 *
 * What happens here depends on what it finds:
 *
 *   SQLite (local development)      push the schema, as before. Migration SQL
 *                                   is PostgreSQL-specific, and the local
 *                                   database is disposable.
 *
 *   PostgreSQL, no migration table  the first release onto an existing
 *                                   database. Push once to make certain the
 *                                   schema is current, then record the initial
 *                                   migration as already applied — baselining,
 *                                   so `migrate deploy` does not try to create
 *                                   tables that are already there.
 *
 *   PostgreSQL, migrations present  `migrate deploy`: apply exactly the
 *                                   migrations that have been written and
 *                                   reviewed, and nothing else.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const MIGRATIONS = "prisma/migrations";
const url = process.env.DATABASE_URL || "";
const isPostgres = /^postgres(ql)?:\/\//i.test(url);

function run(args) {
  execFileSync("npx", ["prisma", ...args], { stdio: "inherit", shell: process.platform === "win32" });
}

/** Migration directories, oldest first. */
function migrationNames() {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS).filter((d) => /^\d+_/.test(d)).sort();
}

if (!isPostgres) {
  console.log("Local database — pushing the schema.");
  run(["db", "push", "--skip-generate"]);
  process.exit(0);
}

const names = migrationNames();
if (names.length === 0) {
  console.log("No migrations written yet — pushing the schema.");
  run(["db", "push", "--skip-generate"]);
  process.exit(0);
}

// Has this database been placed under migration control yet?
const db = new PrismaClient();
let hasHistory = false;
try {
  // information_schema, not to_regclass: regclass is a PostgreSQL-internal type
  // that Prisma's raw-query deserializer cannot read, and the failure took the
  // site down. This returns a plain integer.
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`
  );
  hasHistory = Number(rows?.[0]?.n ?? 0) > 0;
} catch (err) {
  // Never let a question about the database stop the application starting.
  // That was the whole failure this work set out to remove, and exiting here
  // reproduced it exactly. Fall back to the behaviour that was in place before
  // migrations, which is known to work, and say so loudly.
  console.error("Could not inspect the migration history:", err.message);
  console.error("Falling back to a schema push so the application still starts.");
  await db.$disconnect();
  run(["db", "push", "--skip-generate"]);
  process.exit(0);
} finally {
  await db.$disconnect();
}

if (hasHistory) {
  console.log("Applying migrations.");
  run(["migrate", "deploy"]);
} else {
  // First release onto a database built by `db push`. Make the schema current,
  // then record the migrations as applied rather than replaying them — the
  // tables they create already exist.
  console.log("No migration history — baselining this database.");
  run(["db", "push", "--skip-generate"]);
  for (const name of names) {
    console.log(`  marking ${name} as already applied`);
    run(["migrate", "resolve", "--applied", name]);
  }
  console.log("Baselined. Later releases will apply migrations normally.");
}
