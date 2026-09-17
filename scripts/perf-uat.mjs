/**
 * Run the performance and stress test against a PostgreSQL database from this
 * machine, and put the local setup back afterwards.
 *
 *   node scripts/perf-uat.mjs --target=rehearsal --confirm-host=<host>:<port> [--small]
 *   node scripts/perf-uat.mjs --target=uat       --confirm-host=<host>:<port> [--small]
 *
 * The connection string comes from REHEARSAL_DATABASE_URL or UAT_DATABASE_URL
 * in .env (git-ignored) and is never printed. Production is refused outright.
 * The test works inside a scratch company it creates and removes, and checks
 * that every table in the database has the same number of rows afterwards.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

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
const hostPort = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || "5432"}`.toLowerCase(); } catch { return ""; } };
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=")[1] ?? "";

const env = loadEnvFile(".env");
const target = arg("target");
const url = target === "uat" ? env.UAT_DATABASE_URL : target === "rehearsal" ? env.REHEARSAL_DATABASE_URL : "";
const prod = process.env.PROD_DATABASE_URL || env.PROD_DATABASE_URL || "";

if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("\nChoose --target=uat or --target=rehearsal, with that database's URL in .env.\n");
  process.exit(1);
}
if (prod && hostPort(url) === hostPort(prod)) {
  console.error("\nThat is the production database. The performance test never runs there. Refusing.\n");
  process.exit(1);
}
const confirm = arg("confirm-host");
if (confirm.toLowerCase() !== hostPort(url)) {
  console.error(`\nThis writes and removes a scratch company in ${hostPort(url)}.\nIf that is right, run again with --confirm-host=${hostPort(url)}\n`);
  process.exit(1);
}

const redact = (s) => String(s).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^\s]+@/gi, "$1:****@");
const SCHEMA = "prisma/schema.prisma";
const original = readFileSync(SCHEMA, "utf8");
mkdirSync("perf-results", { recursive: true });
const out = `perf-results/${target}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

const pgEnv = {
  ...process.env, DATABASE_URL: url, PRISMA_PROVIDER: "postgresql",
  PERF_CONFIRM_HOST: confirm, PERF_OUT: out, PERF_SCALE: process.argv.includes("--small") ? "small" : "full",
};
const run = (cmd, args, e) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: e });

let failed = false;
try {
  run("node", ["scripts/set-db-provider.mjs"], pgEnv);
  run("npx", ["prisma", "generate"], pgEnv);
  if (process.argv.includes("--count-only")) {
    // Re-check a finished run's cleanup: every table against the recorded count.
    const last = readdirSync("perf-results").filter((f) => f.startsWith(`${target}-`)).sort().pop();
    const recorded = JSON.parse(readFileSync(`perf-results/${last}`, "utf8")).cleanup;
    writeFileSync("perf-results/.expect.json", JSON.stringify(recorded));
    run("node", ["scripts/perf-count.mjs"], { ...pgEnv, PERF_EXPECT: "perf-results/.expect.json" });
  } else {
    run("node", ["--experimental-strip-types", "scripts/perf.mjs"], pgEnv);
    console.log(`\nResults written to ${out}`);
  }
} catch (err) {
  failed = true;
  console.error("\n" + redact(err?.message ?? err));
} finally {
  try {
    writeFileSync(SCHEMA, original);
    const localEnv = { ...process.env };
    delete localEnv.PRISMA_PROVIDER;
    run("node", ["scripts/set-db-provider.mjs"], localEnv);
    run("npx", ["prisma", "generate"], localEnv);
    console.log("Local setup put back to SQLite.");
  } catch (e) {
    console.error("\nCould not put the local setup back to SQLite. Run `npm run db:generate`.\n", redact(e?.message ?? e));
  }
}
process.exit(failed ? 1 : 0);
