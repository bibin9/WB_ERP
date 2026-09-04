/**
 * Build a throwaway Prisma schema that points at the hosted PostgreSQL database,
 * so you can browse and query production WITHOUT touching prisma/schema.prisma
 * (which stays on SQLite for local development).
 *
 * It is generated from the real schema every time, so it can never drift.
 *
 * Reads the connection string from PROD_DATABASE_URL. Put it in .env, which is
 * git-ignored and is also where the Prisma CLI looks:
 *
 *   PROD_DATABASE_URL="postgresql://user:pass@host:port/railway"
 *
 * Used by:  npm run db:prod
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT = "prisma/.prod.prisma";

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
      "Add this line to .env (git-ignored):\n\n" +
      '  PROD_DATABASE_URL="postgresql://user:pass@host:port/railway"\n\n' +
      "Get that string from Railway: Postgres service -> Variables -> DATABASE_PUBLIC_URL.\n" +
      "See DEPLOY.md, 'Querying the hosted database'.\n"
  );
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error(`\nPROD_DATABASE_URL does not look like a Postgres URL:\n  ${url.split(":")[0]}...\n`);
  process.exit(1);
}

// Railway's internal hostname only resolves inside Railway's own network.
if (/\.railway\.internal/i.test(url)) {
  console.error(
    "\nThat is Railway's INTERNAL url, which only works from inside Railway.\n" +
      "Use DATABASE_PUBLIC_URL instead (Postgres service -> Variables).\n"
  );
  process.exit(1);
}

const schema = readFileSync("prisma/schema.prisma", "utf8")
  .replace(/provider = "(?:sqlite|postgresql)"/, 'provider = "postgresql"')
  .replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url      = env("PROD_DATABASE_URL")');

writeFileSync(OUT, schema);

// Make the value visible to the Prisma CLI process that follows.
process.env.PROD_DATABASE_URL = url;

const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
console.log(`Generated ${OUT} -> postgresql @ ${host}`);
