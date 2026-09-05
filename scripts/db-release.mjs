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
  const rows = await db.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') AS t`);
  hasHistory = rows?.[0]?.t !== null && rows?.[0]?.t !== undefined;
} catch (err) {
  console.error("Could not inspect the database:", err.message);
  process.exit(1);
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
