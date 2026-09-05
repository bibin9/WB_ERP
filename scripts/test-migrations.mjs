/**
 * Deploy safety.
 *
 * `prisma db push` on boot stopped the server starting twice in one day: it
 * refused a schema change, and because it sat in an && chain ahead of
 * `next start`, nothing came up at all. These checks hold the replacement in
 * place — migrations that are written and reviewed before they ship.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* --------------------------------------------------- the deploy path ----- */
const pkg = JSON.parse(read("package.json"));
ok("boot no longer pushes the schema", !pkg.scripts.start.includes("db push"), pkg.scripts.start);
ok("boot goes through the release script", pkg.scripts.start.includes("scripts/db-release.mjs"));
ok("a migration can be authored", typeof pkg.scripts["db:migration"] === "string");

const release = read("scripts/db-release.mjs");
ok("PostgreSQL with history applies migrations", release.includes('run(["migrate", "deploy"])'));
ok("a database with no history is baselined, not replayed", release.includes('"migrate", "resolve", "--applied"'));
ok("baselining brings the schema current first", /baselining[\s\S]*?db", "push"/.test(release));
ok("local SQLite still just pushes", release.includes("Local database") && release.includes('db", "push"'));
ok("it decides from the actual database, not a guess", release.includes("_prisma_migrations"));
// regclass is a PostgreSQL-internal type Prisma's raw-query deserializer cannot
// read. Asking for it took the site down; information_schema returns a plain
// integer and is portable.
// Check the code, not the comments — the comment explaining why regclass was
// abandoned naturally mentions it.
const releaseCode = release.replace(/^\s*\/\/.*$/gm, "");
ok("the history check avoids PostgreSQL-internal types",
  releaseCode.includes("information_schema.tables") && !releaseCode.includes("to_regclass"));
ok("a failed check falls back rather than killing the boot",
  /catch[\s\S]*?Falling back[\s\S]*?db", "push"/.test(release) && !/catch[\s\S]*?process\.exit\(1\)/.test(release));

/* ------------------------------------------------------ the migrations -- */
const MIG = "prisma/migrations";
ok("migrations are committed", fs.existsSync(MIG));

const dirs = fs.readdirSync(MIG).filter((d) => /^\d+_/.test(d)).sort();
ok("there is at least one migration", dirs.length >= 1, dirs.join(", "));
ok("the engine is pinned for deploy", read(path.join(MIG, "migration_lock.toml")).includes('provider = "postgresql"'));
ok("a schema snapshot drives the next diff", fs.existsSync(path.join(MIG, ".snapshot.prisma")));

const initSql = read(path.join(MIG, dirs[0], "migration.sql"));
const models = (read("prisma/schema.prisma").match(/^model /gm) || []).length;
const tables = (initSql.match(/CREATE TABLE/g) || []).length;
ok("the first migration creates every model", tables === models, `${tables} tables for ${models} models`);
ok("it is PostgreSQL, not SQLite", !/AUTOINCREMENT|PRAGMA/i.test(initSql) && initSql.includes("TIMESTAMP(3)"));
ok("foreign keys are included", /ADD CONSTRAINT[^;]*FOREIGN KEY/.test(initSql));

// The columns added since the pilot went live must be in it.
const recent = ["vatTreatment", "booksLockedTo", "openingBalance", "controlType", "reversalOfId", "partyId"];
const missing = recent.filter((c) => !initSql.includes(`"${c}"`));
ok("recent schema work is captured", missing.length === 0, missing.join(", ") || recent.join(", "));

/* ------------------------------------------- the destructive warning ----- */
// The author script warns before a migration that can fail or lose data. The
// unique index matters most: that is the exact shape that broke production.
const detector = /DROP TABLE|DROP COLUMN|SET NOT NULL|CREATE UNIQUE INDEX|ADD CONSTRAINT[^;]*UNIQUE/i;
ok("the author script carries that warning", read("scripts/migration.mjs").includes("CREATE UNIQUE INDEX"));

const cases = [
  ['ALTER TABLE "X" DROP COLUMN "y";', true, "dropping a column"],
  ['DROP TABLE "X";', true, "dropping a table"],
  ['CREATE UNIQUE INDEX "k" ON "JournalEntry"("reversalOfId");', true, "a unique index — what broke production"],
  ['ALTER TABLE "X" ALTER COLUMN "y" SET NOT NULL;', true, "making a column required"],
  ['ALTER TABLE "X" ADD COLUMN "y" TEXT;', false, "a plain new column"],
  ['CREATE TABLE "X" ("id" TEXT NOT NULL);', false, "a new table"],
  ['CREATE INDEX "i" ON "X"("y");', false, "a plain index"],
];
for (const [sql, expected, label] of cases) {
  ok(`${expected ? "warns about" : "stays quiet for"} ${label}`, detector.test(sql) === expected);
}

/* ------------------------------------------------- rehearsing a deploy --- */
// Every outage here has been a PostgreSQL-specific failure at boot, invisible
// on SQLite. The rehearsal runs the real sequence against a real PostgreSQL.
const rehearse = read("scripts/rehearse-deploy.mjs");
ok("a deploy can be rehearsed", typeof pkg.scripts["db:rehearse"] === "string");
ok("it runs the real boot sequence", rehearse.includes("scripts/db-release.mjs") && rehearse.includes("prisma/seed.mjs"));
ok("it covers a fresh database and one built by push",
  rehearse.includes("a new, empty database") && rehearse.includes("a database built by db push"));
ok("it checks a redeploy is a no-op", rehearse.includes("deploying again"));
ok("it insists on PostgreSQL", rehearse.includes("must be PostgreSQL"));
ok("it refuses the production database", rehearse.includes("That is the production database"));
ok("it refuses an unnamed live Railway database", rehearse.includes("not named as a scratch one"));
ok("it restores the schema afterwards", /finally[\s\S]*?writeFileSync\(schemaPath, original\)/.test(rehearse));

/* ---------------------------------------------------------- the docs ---- */
const deploy = read("DEPLOY.md");
ok("the deploy guide explains migrations", /migrat/i.test(deploy));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
