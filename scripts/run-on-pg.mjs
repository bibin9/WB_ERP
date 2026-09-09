/**
 * Run the whole test suite against PostgreSQL, not SQLite.
 *
 * Every suite in this repository runs on the SQLite used for local development.
 * Production is PostgreSQL, and they are different engines: `skipDuplicates` on
 * createMany exists on one and not the other, and that was found by accident
 * rather than by a test. A suite that only ever runs on SQLite proves the logic
 * is right on the database nobody ships.
 *
 * So this points the same suites at the throwaway PostgreSQL the deploy
 * rehearsal already uses:
 *
 *   npm run test:pg
 *
 * It wipes that database, pushes the current schema, seeds it, runs every
 * test-*.mjs against it, and puts the local provider back to SQLite whether it
 * passed or not. The guards against running this on anything that looks like
 * production are the same ones the rehearsal uses, for the same reason: it
 * destroys what it is given.
 *
 * The qa-*.mjs scripts are excluded — they drive a running dev server, which is
 * pointed at SQLite. Only the headless suites run here.
 *
 * Named run- rather than test- deliberately: the sweep that runs every
 * test-*.mjs would otherwise pick this up and run it inside itself, wiping the
 * rehearsal database from within its own run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

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

if (!url) {
  console.error(
    "\nREHEARSAL_DATABASE_URL is not set.\n\n" +
      "Add a throwaway PostgreSQL to .env (git-ignored):\n" +
      '  REHEARSAL_DATABASE_URL="postgresql://postgres:pass@localhost:5432/wberp_rehearsal"\n',
  );
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("\nThe target must be PostgreSQL — that is the whole point.\n");
  process.exit(1);
}

// This wipes the database it is given. Make pointing at the client's data by
// accident impossible, with the same two checks the deploy rehearsal uses.
const host = (u) => u.replace(/^.*@/, "").replace(/\?.*$/, "");
if (prodUrl && host(url) === host(prodUrl)) {
  console.error("\nThat is the production database. This wipes what it is given — refusing.\n");
  process.exit(1);
}
if (/rlwy\.net|railway\.internal/i.test(url) && !/rehears|scratch|staging|test/i.test(url)) {
  console.error(
    "\nThat looks like a live Railway database and is not named as a scratch one.\n" +
      "Name it with 'rehearsal', 'staging' or 'test' in it, to be sure.\n",
  );
  process.exit(1);
}

/** Never print a password, in output that may be pasted into a chat or a ticket. */
const redact = (s) => String(s).replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, "$1***@");

const SCHEMA = "prisma/schema.prisma";
const original = readFileSync(SCHEMA, "utf8");
const env = { ...process.env, DATABASE_URL: url, PRISMA_PROVIDER: "postgresql" };

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env, ...opts });

let failed = 0;
let ran = 0;

try {
  console.log(`\nPointing the suite at ${redact(url)}\n`);

  // The provider is swapped at build time by set-db-provider.mjs; the same
  // script does it here, so the schema this runs against is the shipped one.
  run("node", ["scripts/set-db-provider.mjs"]);
  run("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate", "--accept-data-loss"]);
  run("npx", ["prisma", "generate"]);
  run("node", ["prisma/seed.mjs"]);

  const suites = readdirSync("scripts")
    .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
    .sort();

  console.log(`\nRunning ${suites.length} suites on PostgreSQL\n`);

  let passed = 0;
  const broken = [];

  for (const file of suites) {
    const res = spawnSync(
      "node",
      ["--experimental-strip-types", `scripts/${file}`],
      { encoding: "utf8", env, shell: process.platform === "win32" },
    );
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    const line = out.match(/(\d+) passed, (\d+) failed/g)?.pop();

    if (!line) {
      broken.push([file, "did not report a result"]);
      console.log(`  ERROR  ${file}`);
      console.log(redact(out.split("\n").slice(-12).join("\n")));
      continue;
    }
    const [p, f] = line.match(/\d+/g).map(Number);
    passed += p;
    failed += f;
    ran++;
    if (f > 0) {
      broken.push([file, line]);
      console.log(`  FAIL   ${file}  (${line})`);
      // Every suite writes its own failure line: some say FAIL, one uses a
      // cross. Matching one layout would report a failing suite with no
      // reason under it, which is worse than not reporting it at all.
      const bad = out.split("\n").filter((l) => /\bFAIL\b|\u274C|\u2717/.test(l));
      for (const l of bad.slice(0, 8)) console.log(`         ${redact(l.trim())}`);
      if (bad.length === 0) console.log(`         (no failure detail printed by ${file})`);
    } else {
      console.log(`  ok     ${file}  (${p})`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, across ${ran} suites on PostgreSQL`);
  if (broken.length > 0) {
    console.log("\nSuites that did not pass on PostgreSQL but do on SQLite are engine differences.");
    console.log("Those are the ones this script exists to find.\n");
  }
} catch (err) {
  console.error(`\nCould not run against PostgreSQL: ${redact(err?.message ?? err)}\n`);
  failed = failed || 1;
} finally {
  // Put local development back the way it was, whatever happened above. A
  // developer who runs this and is then left on a PostgreSQL schema with no
  // database behind it has a worse afternoon than the bug was worth.
  writeFileSync(SCHEMA, original);
  try {
    execFileSync("npx", ["prisma", "generate"], {
      stdio: "ignore", shell: process.platform === "win32",
    });
    console.log("Local schema and client restored to SQLite.\n");
  } catch {
    console.error("The schema file is restored, but `npx prisma generate` failed — run it yourself.\n");
  }
}

process.exit(failed > 0 ? 1 : 0);
