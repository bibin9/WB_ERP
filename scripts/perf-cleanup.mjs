/**
 * Remove what an interrupted performance run left behind.
 *
 * The run of 20 September lost the database part-way through — Railway's
 * proxy dropped for about a minute — so the soak, the soundness checks and
 * the cleanup all failed against a server that was not answering, and the
 * scratch company stayed. The harness cleans up after itself when it can
 * reach the database; this is for when it could not.
 *
 * It removes only companies the harness itself creates: a code of PT followed
 * by five digits, and the name it writes ("… performance test — removed
 * automatically"). Anything else is left alone, listed, and not touched.
 *
 *   node scripts/perf-uat.mjs --target=uat --confirm-host=<host:port> --cleanup
 */
import { importLibs } from "./lib-shim.mjs";

const url = process.env.DATABASE_URL || "";
const hostPort = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || "5432"}`.toLowerCase(); } catch { return ""; } };
if (!/^postgres(ql)?:\/\//i.test(url) || !process.env.PERF_CONFIRM_HOST || hostPort(url) !== process.env.PERF_CONFIRM_HOST.toLowerCase()) {
  console.error("Run this through scripts/perf-uat.mjs, which confirms the target first.");
  process.exit(1);
}

const { db } = (await importLibs(["db"])).db;
const log = (s = "") => console.log(s);

async function countAll() {
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`,
  );
  const out = {};
  for (const { table_name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table_name}"`);
    out[table_name] = n;
  }
  return out;
}

const scratch = (await db.company.findMany({ select: { id: true, code: true, name: true } }))
  .filter((c) => /^PT\d{5}$/.test(c.code) && /performance test/i.test(c.name));

log(`\nScratch companies left behind: ${scratch.length ? scratch.map((c) => c.code).join(", ") : "none"}`);

for (const company of scratch) {
  const id = company.id;
  // The same order the harness uses: children that point at each other first.
  const steps = [
    () => db.purchaseOrderLine.deleteMany({ where: { order: { companyId: id } } }).then(() => db.stockMovement.deleteMany({ where: { companyId: id } })),
    () => db.purchaseOrder.deleteMany({ where: { companyId: id } }),
    () => db.materialRequest.deleteMany({ where: { companyId: id } }),
    () => db.journalLine.deleteMany({ where: { entry: { companyId: id } } }),
    () => db.journalEntry.deleteMany({ where: { companyId: id } }),
    () => db.approvalRequest.deleteMany({ where: { companyId: id } }),
    () => db.company.delete({ where: { id } }),
  ];
  let failed = 0;
  for (const step of steps) {
    try { await step(); } catch (e) { failed++; console.error(`  ${company.code}: step failed — ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  await db.notification.deleteMany({ where: { OR: [{ title: { contains: company.code } }, { body: { contains: company.code } }] } }).catch(() => {});
  log(`  ${company.code} removed${failed ? ` with ${failed} failed step(s)` : ""}`);
}

const counts = await countAll();
const total = Object.values(counts).reduce((a, b) => a + b, 0);
log(`\n  ${Object.keys(counts).length} tables, ${total.toLocaleString()} rows now`);
const expected = Number(process.env.PERF_EXPECT_ROWS || 0);
if (expected) {
  log(`  ${expected.toLocaleString()} rows before the run — ${total === expected ? "back to where it started" : `${(total - expected).toLocaleString()} DIFFERENCE`}`);
}
const left = (await db.company.findMany({ select: { code: true } })).filter((c) => /^PT\d{5}$/.test(c.code));
log(`  scratch companies remaining: ${left.length ? left.map((c) => c.code).join(", ") : "none"}`);
await db.$disconnect();
process.exit(left.length || (expected && total !== expected) ? 1 : 0);
