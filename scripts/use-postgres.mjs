/**
 * Deploy-time helper: switch the Prisma datasource from SQLite (local dev) to
 * PostgreSQL (production/pilot). Run in the Railway build step BEFORE `prisma generate`.
 * Local development keeps using SQLite; only the deployed build is rewritten.
 * Idempotent — safe to run more than once.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = "prisma/schema.prisma";
const src = readFileSync(path, "utf8");

if (src.includes('provider = "postgresql"')) {
  console.log("schema already targets postgresql — nothing to do");
} else {
  const out = src.replace('provider = "sqlite"', 'provider = "postgresql"');
  if (out === src) { console.error("Could not find sqlite provider to switch"); process.exit(1); }
  writeFileSync(path, out);
  console.log("Switched Prisma datasource: sqlite -> postgresql");
}
