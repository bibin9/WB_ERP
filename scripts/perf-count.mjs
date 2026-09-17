/**
 * Count every table in the target database and compare with the counts a
 * performance run recorded before it wrote anything. Run through perf-uat's
 * provider switch: node scripts/perf-uat.mjs --target=uat --confirm-host=… --count-only
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const expected = JSON.parse(readFileSync(process.env.PERF_EXPECT, "utf8"));
const db = new PrismaClient();
const tables = await db.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
);
let rows = 0;
const leftovers = [];
for (const { table_name } of tables) {
  const [{ n }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table_name}"`);
  rows += n;
  const [{ pt }] = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS pt FROM information_schema.columns WHERE table_name = $1 AND column_name = 'companyId'`, table_name);
  if (pt) {
    const [{ c }] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM "${table_name}" t JOIN "Company" co ON co.id = t."companyId" WHERE co.code LIKE 'PT%' AND co.name LIKE '%performance test%'`);
    if (c) leftovers.push(`${table_name}: ${c}`);
  }
}
const [{ companies }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS companies FROM "Company" WHERE name LIKE '%performance test%'`);
console.log(`tables ${tables.length} · rows now ${rows} · rows before the performance run ${expected.rowsBefore}`);
console.log(`performance-test companies still present: ${companies}`);
console.log(`rows belonging to a performance-test company: ${leftovers.length ? leftovers.join(", ") : "none"}`);
await db.$disconnect();
process.exit(rows === expected.rowsBefore && !companies && !leftovers.length ? 0 : 1);
