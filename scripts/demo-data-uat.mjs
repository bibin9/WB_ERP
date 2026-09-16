/**
 * Load the UAT test data into the UAT database, from this machine.
 *
 *   npm run db:demo:uat -- --confirm-host=<host>:<port>
 *   npm run db:demo:uat -- --confirm-host=<host>:<port> --clean
 *
 * Why it runs here rather than on the server: the server is built on Node 20
 * (.nvmrc), and the test data drives the shipped libraries through
 * --experimental-strip-types, which needs Node 22.6. So it runs locally against
 * the UAT database's public connection string.
 *
 * Why it needs a wrapper: this machine's Prisma client is generated for SQLite
 * for local development, and a SQLite client refuses a PostgreSQL URL. So the
 * provider is switched, the client regenerated, the data loaded — and then
 * everything is put back to SQLite whether it worked or not, the same way the
 * cross-engine test run does it.
 *
 * The connection string comes from UAT_DATABASE_URL in .env, which is
 * git-ignored. It is never typed on the command line, where it would land in
 * shell history, and never printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
const url = process.env.UAT_DATABASE_URL || fileEnv.UAT_DATABASE_URL || "";
const prodUrl = process.env.PROD_DATABASE_URL || fileEnv.PROD_DATABASE_URL || "";

const hostPort = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname}:${x.port || "5432"}`.toLowerCase();
  } catch {
    return "";
  }
};

if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error(
    "\nUAT_DATABASE_URL is not set in .env.\n\n" +
      "In Railway, open the UAT PostgreSQL service, Variables, and copy DATABASE_PUBLIC_URL.\n" +
      "Paste it into .env on this machine (not into a chat, not on the command line):\n\n" +
      '  UAT_DATABASE_URL="postgresql://..."\n',
  );
  process.exit(1);
}
// Railway shows a variable two ways: the template in the Edit box, and the
// address it turns into when revealed or copied. The template got pasted once,
// and the loader answered with an empty host and an empty command to run.
if (url.includes("${{")) {
  console.error(
    "\nUAT_DATABASE_URL holds Railway's template — the text with ${{ … }} in it —\n" +
      "not the address itself. That is what the Edit box shows.\n\n" +
      "Copy the real address instead: Pre-Prod -> Postgres -> Database -> Connect ->\n" +
      "Public Network -> copy the connection URL. Replace the line in .env with it.\n",
  );
  process.exit(1);
}
if (!hostPort(url)) {
  console.error(
    "\nUAT_DATABASE_URL is not a connection string this can read.\n" +
      "Copy it again from Pre-Prod -> Postgres -> Database -> Connect -> Public Network.\n",
  );
  process.exit(1);
}
if (prodUrl && hostPort(url) === hostPort(prodUrl)) {
  console.error("\nUAT_DATABASE_URL points at production. Refusing.\n");
  process.exit(1);
}

const confirm = (process.argv.find((a) => a.startsWith("--confirm-host=")) ?? "").split("=")[1] ?? "";
if (!confirm) {
  console.error(
    `\nThis writes test data into ${hostPort(url)}.\n` +
      "If that is the UAT database, run it again saying so:\n\n" +
      // node directly: PowerShell can drop what follows `npm run … --`.
      `  node scripts/demo-data-uat.mjs --confirm-host=${hostPort(url)}\n`,
  );
  process.exit(1);
}

const passthrough = process.argv.slice(2).filter((a) => !a.startsWith("--confirm-host="));
// Three companies with the same number of jobs tie on the default choice, so
// name the one the UAT walkthroughs were written against unless told otherwise.
if (!passthrough.some((a) => a.startsWith("--company="))) passthrough.push("--company=WBE");

const redact = (s) => String(s).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^\s]+@/gi, "$1:****@");
const SCHEMA = "prisma/schema.prisma";
const original = readFileSync(SCHEMA, "utf8");

const pgEnv = {
  ...process.env,
  DATABASE_URL: url,
  PRISMA_PROVIDER: "postgresql",
  TEST_DATA_CONFIRM_HOST: confirm,
};
const run = (cmd, args, env) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });

let failed = false;
try {
  console.log(`\nLoading UAT test data into ${hostPort(url)}\n`);
  run("node", ["scripts/set-db-provider.mjs"], pgEnv);
  run("npx", ["prisma", "generate"], pgEnv);
  run("node", ["--experimental-strip-types", "scripts/demo-data.mjs", ...passthrough], pgEnv);
} catch (err) {
  failed = true;
  const text = redact(err?.message ?? err);
  console.error("\n" + text);
  if (/EPERM/.test(text)) {
    console.error(
      "\nWindows is holding the database engine file. Stop the local dev server " +
        "(the one on http://localhost:3001) and run this again.\n",
    );
  }
} finally {
  // Put this machine back exactly as it was, whatever happened above.
  try {
    writeFileSync(SCHEMA, original);
    const localEnv = { ...process.env };
    delete localEnv.PRISMA_PROVIDER;
    run("node", ["scripts/set-db-provider.mjs"], localEnv);
    run("npx", ["prisma", "generate"], localEnv);
    console.log("\nLocal setup put back to SQLite.");
  } catch (e) {
    console.error(
      "\nCould not put the local setup back to SQLite. Run `npm run db:generate` before starting the dev server.\n",
      redact(e?.message ?? e),
    );
  }
}

process.exit(failed ? 1 : 0);
