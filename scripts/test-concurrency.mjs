/**
 * Several people doing the same thing at the same instant.
 *
 * A stress test against PostgreSQL found stock issued below zero, an order
 * line received five times over, and most of a burst of purchase orders and
 * vouchers refused for want of a number. These fire the same bursts at the
 * shipped functions and check the outcome that matters: the shelf never goes
 * negative, an order line never receives more than was ordered, and everybody
 * in a burst gets a number, each different and none skipped.
 *
 * Runs against whichever database the suite is pointed at: SQLite locally, and
 * PostgreSQL through scripts/run-on-pg.mjs, where the locks are real advisory
 * locks shared by every connection.
 *
 * Works in a scratch company that is removed at the end.
 */
import { importLibs } from "./lib-shim.mjs";

const libs = await importLibs(["db", "stock-posting", "purchase-posting", "posting", "stock-totals", "stock", "serialise"]);
const { db } = libs.db;
const { recordMovement, postReturn, jobPosition } = libs["stock-posting"];
const { createOrder, createRequest, receiveAgainstOrder } = libs["purchase-posting"];
const { postVoucher } = libs.posting;
const { totalsByItem, totalsByItemAndStore, binHoldingsFor } = libs["stock-totals"];
const { balanceOf, isInward } = libs.stock;
const { serialised } = libs.serialise;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const today = new Date().toISOString().slice(0, 10);
const all = (n, make) => Promise.all(Array.from({ length: n }, (_, k) => make(k).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))));

const template = await db.company.findFirst({ where: { code: "WBE" } });
const code = `CC${String(Date.now()).slice(-5)}`;
let company = null;

try {
  company = await db.company.create({ data: { tenantId: template.tenantId, code, name: `${code} concurrency test`, fyStartMonth: 1, vatTRN: "100000000000003" } });
  const chart = await db.chartOfAccount.findMany({ where: { companyId: template.id } });
  for (const a of chart) {
    await db.chartOfAccount.create({ data: { companyId: company.id, code: a.code, name: a.name, type: a.type, parentGroup: a.parentGroup, controlType: a.controlType } });
  }
  const bank = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Asset" } });
  const income = await db.chartOfAccount.findFirst({ where: { companyId: company.id, type: "Income" } });
  const supplier = await db.party.create({ data: { companyId: company.id, code: `${code}-S`, name: "Concurrency supplier", type: "Supplier" } });
  const job = await db.job.create({ data: { companyId: company.id, code: `${code}-J`, name: "Concurrency job" } });
  const store = await db.store.create({ data: { companyId: company.id, code: `${code}-ST`, name: "Concurrency store" } });
  const item = await db.item.create({ data: { companyId: company.id, code: `${code}-I`, name: "Concurrency item", unitCode: "EA" } });

  /* ------------------------------------------ the last ten on the shelf -- */
  const received = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 10, unitCost: 25, reference: "GRN-1" });
  ok("ten received", received.ok, received.error ?? "");
  const issues = await all(25, (k) => recordMovement({ companyId: company.id, postedBy: `t${k}`, kind: "Issue", itemId: item.id, storeId: store.id, jobId: job.id, date: today, quantity: 1, reference: `ISS-${k}` }));
  const issued = issues.filter((r) => r.ok).length;
  const shelf = balanceOf(await db.stockMovement.findMany({ where: { itemId: item.id, storeId: store.id }, select: { kind: true, quantity: true, value: true, inspection: true } }));
  ok("25 people issuing 1 each from a shelf of 10: exactly 10 get it", issued === 10, `${issued} issued`);
  ok("  and the shelf ends at nought, never below", shelf.quantity === 0, `balance ${shelf.quantity}`);
  ok("  the other 15 are told there is none left", issues.filter((r) => !r.ok).every((r) => /none of|can be issued/i.test(r.error)), issues.find((r) => !r.ok)?.error?.slice(0, 80));
  const issueVouchers = await db.stockMovement.count({ where: { itemId: item.id, kind: "Issue", entryId: { not: null } } });
  ok("  every issue that went through has its voucher", issueVouchers === issued, `${issueVouchers} vouchers`);

  /* -------------------------------- deliveries against one order line -- */
  const po = await createOrder({ companyId: company.id, raisedBy: "t", partyId: supplier.id, storeId: store.id, date: today, lines: [{ itemId: item.id, description: "Line of ten", unitCode: "EA", quantity: 10, unitPrice: 25 }] });
  ok("an order for ten", po.ok, po.error ?? "");
  await db.purchaseOrder.update({ where: { id: po.orderId }, data: { status: "Approved", approvedBy: "t", approvedAt: new Date() } });
  const line = await db.purchaseOrderLine.findFirst({ where: { orderId: po.orderId } });
  const deliveries = await all(10, (k) => receiveAgainstOrder({ orderLineId: line.id, postedBy: `t${k}`, storeId: store.id, date: today, quantity: 5, reference: `DN-${k}` }));
  const accepted = deliveries.filter((r) => r.ok).length;
  const arrived = (await db.stockMovement.aggregate({ where: { purchaseOrderLineId: line.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
  ok("10 deliveries of 5 against a line for 10: exactly 2 accepted", accepted === 2, `${accepted} accepted`);
  ok("  and no more than 10 arrive against it", arrived === 10, `${arrived} received`);
  const order = await db.purchaseOrder.findUnique({ where: { id: po.orderId } });
  ok("  the order shows Received", order.status === "Received", order.status);
  const unlinked = await db.stockMovement.count({ where: { itemId: item.id, kind: "Receipt", reference: { startsWith: "DN-" }, purchaseOrderLineId: null } });
  ok("  every accepted delivery is tied to its line", unlinked === 0, `${unlinked} untied`);

  /* ------------------------------------------------------- numbering -- */
  const vouchers = await all(50, (k) => postVoucher({ companyId: company.id, postedBy: `t${k}`, voucherType: "Journal", date: today, memo: `burst ${k}`,
    lines: [{ accountId: bank.id, debit: 10, credit: 0 }, { accountId: income.id, debit: 0, credit: 10 }] }));
  const refs = vouchers.filter((r) => r.ok).map((r) => r.reference);
  const nums = refs.map((r) => Number(r.split("/").pop())).sort((a, b) => a - b);
  ok("50 vouchers posted at once: all 50 posted", refs.length === 50, `${refs.length} posted${vouchers.find((r) => !r.ok) ? ": " + vouchers.find((r) => !r.ok).error : ""}`);
  ok("  each with its own number", new Set(refs).size === refs.length);
  ok("  and none skipped", nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), `${nums[0]}…${nums[nums.length - 1]}`);

  for (const [label, make, field] of [
    ["purchase orders", (k) => createOrder({ companyId: company.id, raisedBy: `t${k}`, partyId: supplier.id, date: today, lines: [{ description: `O${k}`, unitCode: "EA", quantity: 1, unitPrice: 1 }] }), "number"],
    ["material requests", (k) => createRequest({ companyId: company.id, requestedBy: `t${k}`, lines: [{ description: `R${k}`, unitCode: "EA", quantity: 1 }] }), "number"],
  ]) {
    const rs = await all(25, make);
    const numbers = rs.filter((r) => r.ok).map((r) => r[field]);
    ok(`25 ${label} raised at once: all 25 created with different numbers`, numbers.length === 25 && new Set(numbers).size === 25,
      `${numbers.length} created${rs.find((r) => !r.ok) ? ": " + rs.find((r) => !r.ok).error : ""}`);
  }

  // Return notes had no retry at all: two at once took the same number and the
  // second failed with a database error.
  const another = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 50, unitCost: 25, reference: "GRN-2" });
  ok("more stock for the returns", another.ok, another.error ?? "");
  const out = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: job.id, date: today, quantity: 40, reference: "ISS-BIG" });
  ok("forty issued to the job", out.ok, out.error ?? "");
  const returns = await all(8, (k) => postReturn({ companyId: company.id, postedBy: `t${k}`, jobId: job.id, storeId: store.id, date: today, returnedBy: `Site ${k}`,
    lines: [{ itemId: item.id, condition: "Reusable", quantity: 1 }] }));
  const notes = returns.filter((r) => r.ok).map((r) => r.number);
  ok("8 return notes saved at once: all 8 saved with different numbers", notes.length === 8 && new Set(notes).size === 8,
    `${notes.length} saved${returns.find((r) => !r.ok) ? ": " + returns.find((r) => !r.ok).error?.slice(0, 90) : ""}`);

  /* ------------------------------------- PT-07 · two notes, one job ----- */
  // Found by the Pre-Prod stress test: both notes asked "how much does this
  // job still have out?", both were told the same figure, and both returned
  // it. The job ended up credited with more material than it was ever issued.
  {
    const j2 = await db.job.create({ data: { companyId: company.id, code: `${code}-J2`, name: "Race job" } });
    const stocked = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 100, unitCost: 25, reference: "GRN-J2" });
    ok("stock for the second job", stocked.ok, stocked.error ?? "");
    const issued = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: j2.id, date: today, quantity: 100, reference: "ISS-J2" });
    ok("a hundred issued to it", issued.ok, issued.error ?? "");

    // Six notes of sixty, all at the same instant, against a hundred out.
    const race = await all(6, (k) => postReturn({ companyId: company.id, postedBy: `t${k}`, jobId: j2.id, storeId: store.id, date: today, returnedBy: `Site ${k}`,
      lines: [{ itemId: item.id, condition: "Reusable", quantity: 60 }] }));
    const took = race.filter((r) => r.ok).length;
    ok("six notes of sixty against a hundred out: only one is taken", took === 1, `${took} saved, ${race.length - took} refused`);
    const pos = await jobPosition(company.id, j2.id, item.id);
    ok("  the job is never credited with more than it had out", pos.returned <= pos.issued, `${pos.returned} returned of ${pos.issued} issued`);
    const refusal = race.find((r) => !r.ok)?.error ?? "";
    ok("  and the refusal says what is left", /still out on this job|already been returned/i.test(refusal), refusal.slice(0, 90));
    const notesLeft = await db.materialReturn.count({ where: { companyId: company.id, jobId: j2.id } });
    ok("  a refused note leaves nothing behind", notesLeft === took, `${notesLeft} notes for ${took} taken`);

    // Scrap moves no stock, so its claim lives only on the note itself.
    const j3 = await db.job.create({ data: { companyId: company.id, code: `${code}-J3`, name: "Scrap race job" } });
    const stocked3 = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 50, unitCost: 25, reference: "GRN-J3" });
    const issued3 = await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: j3.id, date: today, quantity: 50, reference: "ISS-J3" });
    ok("fifty issued to the third job", stocked3.ok && issued3.ok, issued3.error ?? "");
    const scrapRace = await all(4, (k) => postReturn({ companyId: company.id, postedBy: `t${k}`, jobId: j3.id, storeId: store.id, date: today, returnedBy: `Site ${k}`,
      lines: [{ itemId: item.id, condition: "Scrap", quantity: 40 }] }));
    const scrapTook = scrapRace.filter((r) => r.ok).length;
    ok("four scrap notes of forty against fifty out: only one is taken", scrapTook === 1, `${scrapTook} saved`);
    const pos3 = await jobPosition(company.id, j3.id, item.id);
    ok("  scrap counts against what the job has out", pos3.returned <= pos3.issued, `${pos3.returned} of ${pos3.issued}`);

    // A note that mixes both, racing itself: the whole note still adds up.
    const j4 = await db.job.create({ data: { companyId: company.id, code: `${code}-J4`, name: "Mixed race job" } });
    await recordMovement({ companyId: company.id, postedBy: "t", kind: "Receipt", itemId: item.id, storeId: store.id, date: today, quantity: 60, unitCost: 25, reference: "GRN-J4" });
    await recordMovement({ companyId: company.id, postedBy: "t", kind: "Issue", itemId: item.id, storeId: store.id, jobId: j4.id, date: today, quantity: 60, reference: "ISS-J4" });
    const mixed = await all(3, (k) => postReturn({ companyId: company.id, postedBy: `t${k}`, jobId: j4.id, storeId: store.id, date: today, returnedBy: `Site ${k}`,
      lines: [{ itemId: item.id, condition: "Reusable", quantity: 30 }, { itemId: item.id, condition: "Scrap", quantity: 20 }] }));
    const mixedTook = mixed.filter((r) => r.ok).length;
    const pos4 = await jobPosition(company.id, j4.id, item.id);
    ok("mixed reusable and scrap notes at once stay inside what was issued", mixedTook === 1 && pos4.returned <= pos4.issued,
      `${mixedTook} saved, ${pos4.returned} returned of ${pos4.issued}`);
  }

  /* --------------------------------------------- database-added totals -- */
  const rows = await db.stockMovement.findMany({ where: { companyId: company.id }, select: { itemId: true, storeId: true, binId: true, kind: true, quantity: true, value: true, inspection: true } });
  const byItem = await totalsByItem(company.id);
  const fromRows = balanceOf(rows.filter((r) => r.itemId === item.id));
  const fromTotals = balanceOf(byItem.get(item.id) ?? []);
  ok("stock totalled by the database matches adding up every movement", JSON.stringify(fromRows) === JSON.stringify(fromTotals), `${fromTotals.quantity} @ ${fromTotals.averageCost}`);
  const byPair = await totalsByItemAndStore(company.id);
  ok("  per item and store too", JSON.stringify(balanceOf(byPair.get(`${item.id}:${store.id}`) ?? [])) === JSON.stringify(fromRows));
  ok("  and for one store", JSON.stringify(balanceOf((await totalsByItem(company.id, store.id)).get(item.id) ?? [])) === JSON.stringify(fromRows));

  /* -------------------------------------------------- the lock itself -- */
  let inside = 0, most = 0;
  await Promise.all(Array.from({ length: 12 }, () => serialised(["test-key"], async () => {
    inside++; most = Math.max(most, inside);
    await new Promise((r) => setTimeout(r, 5));
    inside--;
  })));
  ok("work under the same key never overlaps", most === 1, `at most ${most} inside`);
  const failing = await serialised(["test-key"], async () => { throw new Error("boom"); }).catch((e) => e.message);
  const after = await serialised(["test-key"], async () => "released");
  ok("a failure inside releases the lock for the next caller", failing === "boom" && after === "released");
} finally {
  if (company) {
    const id = company.id;
    await db.materialReturnLine.deleteMany({ where: { return: { companyId: id } } });
    await db.materialReturn.deleteMany({ where: { companyId: id } });
    await db.stockMovement.deleteMany({ where: { companyId: id } });
    await db.purchaseOrderLine.deleteMany({ where: { order: { companyId: id } } });
    await db.purchaseOrder.deleteMany({ where: { companyId: id } });
    await db.materialRequestLine.deleteMany({ where: { request: { companyId: id } } });
    await db.materialRequest.deleteMany({ where: { companyId: id } });
    await db.journalLine.deleteMany({ where: { entry: { companyId: id } } });
    await db.journalEntry.deleteMany({ where: { companyId: id } });
    await db.item.deleteMany({ where: { companyId: id } });
    await db.store.deleteMany({ where: { companyId: id } });
    await db.job.deleteMany({ where: { companyId: id } });
    await db.party.deleteMany({ where: { companyId: id } });
    await db.chartOfAccount.deleteMany({ where: { companyId: id } });
    await db.company.delete({ where: { id } }).catch((e) => console.log("  cleanup: " + e.message));
  }
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
