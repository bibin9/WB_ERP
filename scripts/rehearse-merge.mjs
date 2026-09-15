/**
 * Rehearsing the phase-2 merge, which is not the test `db:rehearse` runs.
 *
 * `db:rehearse` answers "does the newest migration apply cleanly on top of
 * everything before it". That is the right question when one migration ships.
 * It is the wrong question here: production is on `main` and has never seen a
 * single one of the migrations phase 2 wrote. The real question is what happens
 * when a database at phase-1's state receives all of them at once, with the
 * client's data already sitting in it.
 *
 * So this builds a database from main's migrations, seeds it with main's seed,
 * counts what is in it, applies the phase-2 migrations on top, and counts
 * again. Anything that went down rather than up is a merge that must not
 * happen.
 *
 * Wipes whatever it is given, so it refuses anything that looks like
 * production, on the same terms as the deploy rehearsal.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
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
const BASE = process.env.MERGE_BASE_REF || "main";

if (!url) {
  console.error("\nREHEARSAL_DATABASE_URL is not set in .env. See DEPLOY.md.\n");
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("\nThe rehearsal database must be PostgreSQL. Rehearsing on SQLite proves nothing.\n");
  process.exit(1);
}

// The same guards as the deploy rehearsal, for the same reason: this wipes.
const host = (u) => u.replace(/^.*@/, "").replace(/\?.*$/, "");
if (prodUrl && host(url) === host(prodUrl)) {
  console.error("\nThat is production. This wipes what it is given, so it is refusing.\n");
  process.exit(1);
}
if (/rlwy\.net|railway\.internal/i.test(url) && !/rehears|scratch|staging|test/i.test(url)) {
  console.error("\nThat looks like a live Railway database and is not named as a scratch one. Refusing.\n");
  process.exit(1);
}

function findPsql() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return "psql";
  } catch {
    /* fall through to the usual install location */
  }
  for (const root of ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) {
      const p = `${root}/${v}/bin/psql.exe`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const PSQL = findPsql();
if (!PSQL) {
  console.error("\npsql was not found. Install the PostgreSQL client tools or add them to PATH.\n");
  process.exit(1);
}

/**
 * Take the password out of anything on its way to the terminal.
 *
 * Two passes, because neither is sufficient alone. The pattern catches any
 * database URL in a driver error, greedily to the last at-sign so a password
 * that itself contains one does not leak its tail. The literal catches the
 * password wherever it appears without a URL around it. It deliberately does
 * not match a bare colon-and-at-sign, because Windows paths in a stack trace
 * are full of those and redacting them makes a failure unreadable.
 */
const passwords = [url, prodUrl]
  .map((u) => {
    try {
      return decodeURIComponent(new URL(u).password || "");
    } catch {
      return "";
    }
  })
  .filter((p) => p.length > 2);

const redact = (text) => {
  let out = String(text).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^\s]+@/gi, "$1:****@");
  for (const secret of passwords) out = out.split(secret).join("****");
  return out;
};

const env = { ...process.env, DATABASE_URL: url };
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env, ...opts });
const sql = (statement) => execFileSync(PSQL, [url, "-t", "-A", "-c", statement], { encoding: "utf8" }).trim();
const tables = () =>
  Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"));
const count = (table) => {
  try {
    return Number(sql(`SELECT COUNT(*) FROM "${table}"`));
  } catch {
    return -1; // the table is not there
  }
};

/**
 * Which tables belong to which phase, read from the two schemas rather than
 * typed out here. A hand-written list rots the moment somebody adds a model,
 * and a check against a table that does not exist passes for the wrong reason
 * — which is exactly how a rehearsal ends up proving nothing.
 */
function modelsIn(text) {
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

const scratch = mkdtempSync(join(tmpdir(), "wb-merge-"));
const stashed = join(scratch, "phase2");
const MIGRATIONS = "prisma/migrations";
const SCHEMA = "prisma/schema.prisma";
// Inside the project, so the seed can resolve @prisma/client and bcryptjs.
const BASE_SEED = "prisma/.rehearsal-base-seed.mjs";
let failed = false;

/** Pull a file out of a git ref without touching the working tree. */
function fromRef(ref, path, dest) {
  const bytes = execFileSync("git", ["show", ref + ":" + path], { maxBuffer: 64 * 1024 * 1024 });
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
}

/**
 * Both branches keep SQLite in the schema for zero-install local dev. The
 * rehearsal is only worth running on PostgreSQL, so flip whichever schema is
 * in place before generating against it.
 */
function usePostgres() {
  const text = readFileSync(SCHEMA, "utf8");
  if (!text.includes('provider = "sqlite"')) return;
  writeFileSync(SCHEMA, text.replace('provider = "sqlite"', 'provider = "postgresql"'));
}

function restorePhase2() {
  if (!existsSync(stashed)) return;
  rmSync(MIGRATIONS, { recursive: true, force: true });
  cpSync(join(stashed, "migrations"), MIGRATIONS, { recursive: true });
  cpSync(join(stashed, "schema.prisma"), SCHEMA);
}

try {
  console.log("\nRehearsing the phase-2 merge against", redact(url));

  /* --- 1. a database shaped the way the client database is --------------- */
  console.log("\n1. Building a database from " + BASE + " migrations only.");

  // Put phase 2 migrations and schema somewhere safe first.
  mkdirSync(stashed, { recursive: true });
  cpSync(MIGRATIONS, join(stashed, "migrations"), { recursive: true });
  cpSync(SCHEMA, join(stashed, "schema.prisma"));

  const mainFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", BASE, "--", MIGRATIONS], {
    encoding: "utf8",
  }).split(/\r?\n/).filter(Boolean);
  if (mainFiles.length === 0) throw new Error(BASE + " has no migrations. Is that ref right?");

  rmSync(MIGRATIONS, { recursive: true, force: true });
  for (const path of mainFiles) fromRef(BASE, path, path);
  fromRef(BASE, SCHEMA, SCHEMA);
  fromRef(BASE, "prisma/seed.mjs", BASE_SEED);

  const phase1Models = modelsIn(execFileSync("git", ["show", BASE + ":" + SCHEMA], { encoding: "utf8" }));
  const phase2Models = modelsIn(readFileSync(join(stashed, "schema.prisma"), "utf8"));
  const PHASE1 = phase1Models;
  const PHASE2 = phase2Models.filter((m) => !phase1Models.includes(m));
  const dropped = phase1Models.filter((m) => !phase2Models.includes(m));
  if (dropped.length) {
    // Not automatically wrong, but a model disappearing between branches is
    // the one thing that loses data silently, so it is said out loud.
    console.log("   note phase 2 no longer has these models: " + dropped.join(", "));
  }

  const baseCount = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).length;
  const aheadCount =
    readdirSync(join(stashed, "migrations")).filter((d) => /^\d{14}_/.test(d)).length - baseCount;
  console.log(`   ${baseCount} migrations on ${BASE}; phase 2 adds ${aheadCount} it has never seen.`);

  sql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  usePostgres();
  run("npx", ["prisma", "generate"], { stdio: "pipe" });
  run("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe" });
  const tablesBefore = tables();
  console.log(`   ${tablesBefore} tables.`);

  /* --- 2. with the client kind of data in it ------------------------------ */
  console.log("\n2. Seeding it with the " + BASE + " seed, the way production is seeded.");
  run("node", [BASE_SEED], { stdio: "pipe" });

  const before = {};
  for (const t of PHASE1) before[t] = count(t);
  console.log(
    `   ${before.Company} companies, ${before.Party} parties, ${before.Job} jobs, ` +
      `${before.JournalEntry} vouchers, ${before.JournalLine} journal lines, ${before.Employee} employees.`,
  );
  if (before.JournalEntry < 1 || before.Company < 1) {
    throw new Error("The seeded database is empty, so this would prove nothing. Stopping.");
  }

  /* --- 3. the merge itself ------------------------------------------------ */
  console.log(`\n3. Applying the ${aheadCount} migrations production has never seen.`);
  restorePhase2();
  usePostgres();
  run("npx", ["prisma", "generate"], { stdio: "pipe" });
  run("npx", ["prisma", "migrate", "deploy"]);

  /* --- 4. counting what survived ------------------------------------------ */
  console.log("\n4. Phase-1 data, before and after.\n");
  let empty = 0;
  for (const t of PHASE1) {
    const b = before[t];
    const a = count(t);
    if (a === -1) {
      failed = true;
      console.log(`   GONE ${t.padEnd(18)} the table itself is no longer there`);
      continue;
    }
    if (b === 0 && a === 0) {
      empty++; // nothing was in it, so nothing could be lost
      continue;
    }
    const ok = a >= b;
    if (!ok) failed = true;
    console.log(`   ${ok ? "ok  " : "LOST"} ${t.padEnd(18)} ${String(b).padStart(5)} -> ${String(a).padStart(5)}`);
  }
  console.log(`   ..   and ${empty} phase-1 tables that were empty before and after`);

  console.log(`\n   Tables ${tablesBefore} -> ${tables()}.`);

  const missing = [];
  const unexpected = [];
  for (const t of PHASE2) {
    const n = count(t);
    if (n === -1) missing.push(t);
    else if (n !== 0) unexpected.push(`${t} (${n})`);
  }
  if (missing.length) {
    failed = true;
    console.log(`   MISSING tables the merge should have created: ${missing.join(", ")}`);
  } else {
    console.log(`   ok   all ${PHASE2.length} phase-2 tables created`);
  }
  if (unexpected.length) {
    // Not a failure. A migration inventing rows is worth a human looking at it.
    console.log(`   note rows appeared without anyone putting them there: ${unexpected.join(", ")}`);
  }

  /* --- 5. and the boot that follows a deploy ------------------------------ */
  console.log("\n5. Running the phase-2 seed on top, which is what a deploy does on boot.");
  const vouchersAfterMerge = count("JournalEntry");
  run("node", ["prisma/seed.mjs"], { stdio: "pipe" });
  const vouchersAfterSeed = count("JournalEntry");
  if (vouchersAfterSeed < vouchersAfterMerge) {
    failed = true;
    console.log(`   LOST the seed removed vouchers: ${vouchersAfterMerge} -> ${vouchersAfterSeed}`);
  } else {
    console.log(`   ok   vouchers ${vouchersAfterMerge} -> ${vouchersAfterSeed}`);
  }

  // A second boot, because Railway restarts containers for its own reasons and
  // a seed that is not idempotent duplicates the chart of accounts every time.
  // Against a table the seed actually fills. Comparing two counts of a table
  // that does not exist passes every time and proves nothing.
  const witness = "ChartOfAccount";
  const once = count(witness);
  if (once <= 0) {
    failed = true;
    console.log(`   ?    ${witness} holds ${once} rows, so this check would prove nothing. Fix the witness.`);
  } else {
    run("node", ["prisma/seed.mjs"], { stdio: "pipe" });
    const twice = count(witness);
    if (twice !== once) {
      failed = true;
      console.log(`   LOST the seed is not idempotent: ${witness} ${once} -> ${twice} on re-run`);
    } else {
      console.log(`   ok   seed is idempotent across restarts (${witness} ${once}, unchanged)`);
    }
  }

  console.log(
    failed
      ? "\nMERGE REHEARSAL FAILED. Do not merge.\n"
      : `\nMerge rehearsal passed: a ${BASE} database with data took all ${aheadCount} migrations and lost nothing.\n`,
  );
} catch (err) {
  failed = true;
  console.error("\n" + redact(String(err?.message ?? err)));
  console.error("\nMERGE REHEARSAL FAILED. This is what would have happened to the client.\n");
} finally {
  try {
    restorePhase2();
  } catch (e) {
    console.error("\nCould not restore prisma/. Check `git status` before doing anything else.\n", e);
  }
  rmSync(BASE_SEED, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
