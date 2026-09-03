/**
 * Set the Prisma datasource provider to match DATABASE_URL.
 *  - a postgres:// or postgresql:// URL  -> provider = "postgresql"  (deploy/production)
 *  - anything else (or unset)            -> provider = "sqlite"      (local dev)
 * Runs before every Prisma step (postinstall / build / start) so the schema and the
 * connection string never disagree. Idempotent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = "prisma/schema.prisma";
const url = process.env.DATABASE_URL || "file:./dev.db";
const provider = /^postgres(ql)?:\/\//i.test(url) ? "postgresql" : "sqlite";

const src = readFileSync(path, "utf8");
// Only the datasource provider is sqlite/postgresql; the generator is "prisma-client-js".
const out = src.replace(/provider = "(?:sqlite|postgresql)"/, `provider = "${provider}"`);

if (out !== src) {
  writeFileSync(path, out);
  console.log(`Prisma provider set to "${provider}" (from DATABASE_URL)`);
} else {
  console.log(`Prisma provider already "${provider}"`);
}
