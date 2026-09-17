/**
 * Giving up politely when the system is busy — and leaving nothing half done.
 *
 * The Pre-Prod stress test left 23 stock movements with no voucher. A voucher
 * posting that ran out of time waiting for its number threw an error instead
 * of refusing, and the movement it was for was only removed on a refusal. The
 * shelf and the ledger then disagreed.
 *
 * This shortens the wait (LOCK_WAIT_MS) and holds the locks itself, so the
 * give-up path runs on demand: waiting for a busy shelf is a refusal with
 * nothing written, and a posting that gives up takes its movement with it.
 * On PostgreSQL the lock is held by a real advisory lock in a transaction of
 * its own; on SQLite by the in-memory queue.
 */
process.env.LOCK_WAIT_MS = "400";
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs(["db", "stock-posting", "posting", "serialise"]);
const { db } = libs.db;
const { recordMovement } = libs["stock-posting"];
const { postVoucher } = libs.posting;
const { serialised, usesAdvisoryLocks, shelfKey, seriesKey, BUSY_MESSAGE, LOCK_WAIT_MS } = libs.serialise;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hold a lock for `ms`, the way another user's slow save would. */
function hold(key, ms) {
  if (usesAdvisoryLocks()) {
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await sleep(ms);
    }, { timeout: ms + 5000, maxWait: 5000 });
  }
  return serialised([key], () => sleep(ms));
}

ok("the wait is shortened for this test", LOCK_WAIT_MS === 400, `${LOCK_WAIT_MS} ms`);

const template = await db.company.findFirst({ where: { code: "WBE" } });
const code = `BZ${String(Date.now()).slice(-5)}`;
let company = null;
try {
  company = await db.company.create({ data: { tenantId: template.tenantId, code, name: `${code} busy test`, fyStartMonth: 1, vatTRN: "100000000000003" } });
  for (const a of await db.chartOfAccount.findMany({ where: { companyId: template.id } })) {
    await db.chartOfAccount.create({ data: { companyId: company.id, code: a.code, name: a.name, type: a.type, parentGroup: a.parentGroup, controlType: a.controlType } });
  }
  const job = await db.job.create({ data: { companyId: company.id, code: `${code}-J`, name: "Busy job" } });
  const store = await db.store.create({ data: { companyId: company.id, code: `${code}-S`, name: "Busy store" } });
  const item = await db.item.create({ data: { companyId: company.id, code: `${code}-I`, name: "Busy item", unitCode: "EA" } });
  const bank = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Asset" } });
  const income = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Income" } });

  const first = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 10, unitCost: 5, reference: "BZ-GRN-1" });
  ok("stock received normally when nobody else is saving", first.ok, first.error ?? "");
  const prefix = first.reference.slice(0, first.reference.lastIndexOf("/") + 1);

  /* --------------------------------------------- the shelf is busy -- */
  const holding = hold(shelfKey(company.id, item.id, store.id), 1500);
  await sleep(100);
  const before = await db.stockMovement.count({ where: { companyId: company.id } });
  const issue = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: job.id, date: today, quantity: 1, reference: "BZ-ISS" });
  await holding;
  ok("an issue that waits too long for the shelf is refused, not thrown", issue.ok === false && issue.error === BUSY_MESSAGE, issue.error ?? "went through");
  ok("  and writes nothing", (await db.stockMovement.count({ where: { companyId: company.id } })) === before);

  /* -------------------------------------- the voucher series is busy -- */
  const holdingSeries = hold(seriesKey(company.id, prefix), 1500);
  await sleep(100);
  const receipt = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 5, unitCost: 5, reference: "BZ-GRN-2" });
  await holdingSeries;
  ok("a receipt whose voucher waits too long for a number is refused, not thrown", receipt.ok === false && receipt.error === BUSY_MESSAGE, receipt.error ?? "went through");
  const orphans = await db.stockMovement.count({ where: { companyId: company.id, entryId: null, kind: { in: ["Receipt", "Issue"] } } });
  ok("  and leaves no stock movement without its voucher", orphans === 0, `${orphans} without a voucher`);
  const grn2 = await db.stockMovement.count({ where: { companyId: company.id, reference: "BZ-GRN-2" } });
  ok("  the movement it was for is gone", grn2 === 0);

  const direct = hold(seriesKey(company.id, prefix), 1500);
  await sleep(100);
  const voucher = await postVoucher({ companyId: company.id, postedBy: "t", voucherType: "Journal", date: today, memo: "busy",
    lines: [{ accountId: bank.id, debit: 1, credit: 0 }, { accountId: income.id, debit: 0, credit: 1 }] });
  await direct;
  ok("posting a voucher while its series is held refuses politely", voucher.ok === false && voucher.error === BUSY_MESSAGE, voucher.error ?? "went through");

  /* ------------------------------------------------ and afterwards -- */
  const after = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: job.id, date: today, quantity: 1, reference: "BZ-ISS-2" });
  ok("once the locks are free, the same issue goes through", after.ok, after.error ?? "");
} finally {
  if (company) {
    const id = company.id;
    await db.stockMovement.deleteMany({ where: { companyId: id } });
    await db.journalLine.deleteMany({ where: { entry: { companyId: id } } });
    await db.journalEntry.deleteMany({ where: { companyId: id } });
    await db.item.deleteMany({ where: { companyId: id } });
    await db.store.deleteMany({ where: { companyId: id } });
    await db.job.deleteMany({ where: { companyId: id } });
    await db.chartOfAccount.deleteMany({ where: { companyId: id } });
    await db.company.delete({ where: { id } }).catch((e) => console.log("  cleanup: " + e.message));
  }
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
