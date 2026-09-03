/**
 * Set the Prisma datasource provider so it is correct at BUILD time (when Next.js bundles
 * the Prisma client into .next) as well as at runtime.
 *
 * Uses PostgreSQL when any of these is true:
 *   - DATABASE_URL is a postgres:// / postgresql:// URL, OR
 *   - we're building/running on Railway (any RAILWAY_* env var is present), OR
 *   - PRISMA_PROVIDER=postgresql is set explicitly.
 * Otherwise stays on SQLite (local dev).
 *
 * The Railway check matters because Railway's ${{Postgres.DATABASE_URL}} reference is not
 * resolved during the build, so we can't rely on DATABASE_URL alone at build time.
 * Idempotent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL || "";
const onRailway = Object.keys(process.env).some((k) => k.startsWith("RAILWAY_"));
const explicit = (process.env.PRISMA_PROVIDER || "").toLowerCase();

const wantPostgres =
  explicit === "postgresql" ||
  /^postgres(ql)?:\/\//i.test(url) ||
  (onRailway && explicit !== "sqlite");

const provider = wantPostgres ? "postgresql" : "sqlite";

const path = "prisma/schema.prisma";
const src = readFileSync(path, "utf8");
const out = src.replace(/provider = "(?:sqlite|postgresql)"/, `provider = "${provider}"`);

if (out !== src) {
  writeFileSync(path, out);
  console.log(`Prisma provider set to "${provider}" (railway=${onRailway}, url=${url ? url.split(":")[0] : "unset"})`);
} else {
  console.log(`Prisma provider already "${provider}"`);
}
