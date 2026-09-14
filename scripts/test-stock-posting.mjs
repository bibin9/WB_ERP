/**
 * What a stock movement does to the books.
 *
 * The rule the whole module turns on: material arriving is an asset, and only
 * becomes a cost on the day it is issued to a job. Get that the wrong way round
 * and a month looks terrible because a delivery landed on the 30th, and the
 * month after looks wonderful for exactly the same reason.
 *
 * Driven through lib/stock-posting rather than the screen's actions, because a
 * server action needs a request behind it and these rules are worth more than a
 * text search over the file that contains them.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs([
  "stock-posting", "stock", "posting", "accounts", "financepolicy", "money", "db", "period", "vat",
]);
const { db } = libs["db"];
const { recordMovement, transferStock, balanceFor } = libs["stock-posting"];
const { balanceOf } = libs["stock"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const today = () => new Date().toISOString().slice(0, 10);

const co = await db.company.findFirst({ where: { code: "WBE" } });
const job = await db.job.findFirst({ where: { companyId: co.id } });
const supplier = await db.party.findFirst({ where: { companyId: co.id } });

const tag = `STK-${Date.now()}`;
const made = [];

/** The voucher a movement posted, by account code. */
async function linesOf(entryId) {
  const e = await db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: { select: { code: true, type: true } } } } },
  });
  return e.lines.map((l) => ({
    code: l.account.code, type: l.account.type, debit: l.debit, credit: l.credit, jobId: l.jobId,
  }));
}

async function move(fields) {
  const res = await recordMovement({
    companyId: co.id, postedBy: "tester", date: today(), reference: tag, ...fields,
  });
  if (res.ok) made.push(res.movementId);
  return res;
}

try {
  const item = await db.item.create({
    data: { companyId: co.id, code: `${tag}-CBL`, name: "4-core 16mm cable", unitCode: "MTR", reorderLevel: 50 },
  });
  const loose = await db.item.create({
    data: { companyId: co.id, code: `${tag}-SVC`, name: "Crane hire", unitCode: "DAY", isStocked: false },
  });
  const main = await db.store.create({ data: { companyId: co.id, code: `${tag}-MAIN`, name: "Main store", isDefault: true } });
  const site = await db.store.create({ data: { companyId: co.id, code: `${tag}-SITE`, name: "Site container" } });

  ok("an item and two stores exist to work with", !!item && !!main && !!site);

  /* ============================================= arriving is an asset === */
  {
    const res = await move({ kind: "Receipt", itemId: item.id, storeId: main.id, quantity: 100, unitCost: 12, partyId: supplier.id });
    ok("a receipt is recorded", res.ok, res.ok ? "" : res.error);
    ok("  and posts", !!res.entryId);

    const lines = await linesOf(res.entryId);
    ok("inventory is debited with what arrived", lines.find((l) => l.code === "1200")?.debit === 1200);
    ok("  and the supplier is owed for it", lines.find((l) => l.code === "2250")?.credit === 1200,
      "goods received, not yet invoiced");

    /**
     * The rule the module exists for. A delivery on the 30th must not land in
     * the profit and loss for that month.
     */
    ok("nothing reaches the profit and loss", !lines.some((l) => l.type === "Expense" || l.type === "Income"),
      "material arriving is an asset, not a cost");
    ok("the voucher balances",
      lines.reduce((t, l) => t + l.debit, 0) === lines.reduce((t, l) => t + l.credit, 0));

    const b = await balanceFor(co.id, item.id, main.id);
    ok("the shelf shows it", b.quantity === 100 && b.value === 1200 && b.averageCost === 12);
  }

  /* ================================== a second price moves the average == */
  {
    await move({ kind: "Receipt", itemId: item.id, storeId: main.id, quantity: 100, unitCost: 18, partyId: supplier.id });
    const b = await balanceFor(co.id, item.id, main.id);
    ok("a receipt at a new price moves the average", b.averageCost === 15, String(b.averageCost));
    ok("  and the value follows it", b.quantity === 200 && b.value === 3000);
  }

  /* ================================== issuing is what costs a contract == */
  {
    const res = await move({ kind: "Issue", itemId: item.id, storeId: main.id, quantity: 50, jobId: job.id });
    ok("an issue is recorded", res.ok, res.ok ? "" : res.error);
    ok("  priced at the average of the moment, not at either purchase price",
      res.unitCost === 15 && res.value === 750, `${res.unitCost} / ${res.value}`);

    const lines = await linesOf(res.entryId);
    ok("site materials is debited", lines.find((l) => l.code === "5200")?.debit === 750);
    ok("  and tagged to the job, which is the whole point",
      lines.find((l) => l.code === "5200")?.jobId === job.id,
      "this is how material finally reaches job costing");
    ok("inventory comes down by the same", lines.find((l) => l.code === "1200")?.credit === 750);

    const b = await balanceFor(co.id, item.id, main.id);
    ok("the shelf comes down too", b.quantity === 150 && b.value === 2250);
    ok("  and the average is unchanged by issuing", b.averageCost === 15);
  }

  /* ============================================ what must be refused ==== */
  {
    const r = await move({ kind: "Issue", itemId: item.id, storeId: main.id, quantity: 1000, jobId: job.id });
    ok("issuing more than is on the shelf is refused", r.ok === false);
    ok("  and the refusal says how much there is", /Only 150/.test(r.error || ""), r.error);

    const b = await balanceFor(co.id, item.id, main.id);
    ok("  leaving the shelf untouched", b.quantity === 150, "a refused movement writes nothing");
  }
  {
    const r = await move({ kind: "Issue", itemId: item.id, storeId: main.id, quantity: 10 });
    ok("an issue with no job is refused", r.ok === false);
    ok("  because the cost would land on nothing", /puts the cost on nothing/.test(r.error || ""), r.error);
  }
  {
    const r = await move({ kind: "Receipt", itemId: loose.id, storeId: main.id, quantity: 1, unitCost: 500 });
    ok("an item that is not stocked cannot move on a shelf", r.ok === false);
    ok("  and is told where it does belong", /supplier invoice/.test(r.error || ""), r.error);
  }
  {
    const r = await move({ kind: "Issue", itemId: item.id, storeId: site.id, quantity: 1, jobId: job.id });
    ok("issuing from a store that never received it is refused", r.ok === false);
    ok("  naming the store that does have it", /Receive it first/.test(r.error || ""), r.error);
  }

  /* ================================================ material coming back = */
  {
    const res = await move({ kind: "Return to store", itemId: item.id, storeId: main.id, quantity: 10, unitCost: 15, jobId: job.id });
    ok("unused material can come back", res.ok, res.ok ? "" : res.error);

    const lines = await linesOf(res.entryId);
    ok("  the job is credited with what it cost", lines.find((l) => l.code === "5200")?.credit === 150);
    ok("  and it is credited to that job, not to nobody", lines.find((l) => l.code === "5200")?.jobId === job.id);
    ok("  inventory goes back up", lines.find((l) => l.code === "1200")?.debit === 150);
  }

  /* ====================================== a transfer moves no money ===== */
  {
    const res = await transferStock({
      companyId: co.id, postedBy: "tester", date: today(), reference: `${tag}-TR`,
      itemId: item.id, storeId: main.id, toStoreId: site.id, quantity: 40,
    });
    ok("stock can be moved between stores", res.ok, res.ok ? "" : res.error);
    if (res.ok) { made.push(res.out, res.in); }

    const out = await db.stockMovement.findUnique({ where: { id: res.out } });
    const arrival = await db.stockMovement.findUnique({ where: { id: res.in } });
    ok("  nothing is posted either end", out.entryId === null && arrival.entryId === null,
      "moving a drum between stores changes where it is, not what the company owns");
    ok("  it arrives at what it left for", arrival.unitCost === out.unitCost && arrival.value === out.value,
      "or value would appear from nowhere");

    const here = await balanceFor(co.id, item.id, main.id);
    const there = await balanceFor(co.id, item.id, site.id);
    ok("  the main store is lighter", here.quantity === 120, String(here.quantity));
    ok("  the site store has it", there.quantity === 40, String(there.quantity));
    ok("  and the company owns exactly what it did before",
      Math.round((here.value + there.value) * 100) / 100 === 2400, `${here.value} + ${there.value}`);
  }
  {
    const r = await transferStock({
      companyId: co.id, postedBy: "tester", date: today(), reference: `${tag}-X`,
      itemId: item.id, storeId: main.id, toStoreId: main.id, quantity: 1,
    });
    ok("a transfer to the same store is refused", r.ok === false, r.error);
  }

  /* ======================================== an adjustment has no job ==== */
  {
    const res = await move({ kind: "Adjustment out", itemId: item.id, storeId: main.id, quantity: 5 });
    ok("stock found missing can be written off", res.ok, res.ok ? "" : res.error);
    const lines = await linesOf(res.entryId);
    ok("  it reaches the profit and loss", lines.some((l) => l.type === "Expense" && l.debit > 0),
      "unlike a receipt, a loss is a cost the moment it is found");
    ok("  against no job, because no contract received it",
      lines.find((l) => l.code === "5200")?.jobId === null);
  }

  /* ============================================== the shelf adds up ===== */
  {
    const all = await db.stockMovement.findMany({
      where: { companyId: co.id, itemId: item.id },
      select: { kind: true, quantity: true, value: true },
    });
    const both = balanceOf(all);
    const here = await balanceFor(co.id, item.id, main.id);
    const there = await balanceFor(co.id, item.id, site.id);
    ok("the stores add up to the item",
      Math.round((here.quantity + there.quantity) * 1000) / 1000 === both.quantity,
      `${here.quantity} + ${there.quantity} = ${both.quantity}`);
  }

  /* ==================================== the ledger agrees with the shelf = */
  {
    const posted = await db.stockMovement.findMany({
      where: { companyId: co.id, reference: { startsWith: tag }, entryId: { not: null } },
      select: { entryId: true },
    });
    let inventoryNet = 0;
    for (const p of posted) {
      for (const l of await linesOf(p.entryId)) {
        if (l.code === "1200") inventoryNet += l.debit - l.credit;
      }
    }
    const here = await balanceFor(co.id, item.id, main.id);
    const there = await balanceFor(co.id, item.id, site.id);
    ok("what the ledger says inventory is worth is what is on the shelves",
      Math.round(inventoryNet * 100) / 100 === Math.round((here.value + there.value) * 100) / 100,
      `ledger ${Math.round(inventoryNet * 100) / 100} against shelves ${here.value + there.value}`);
  }
} finally {
  const rows = await db.stockMovement.findMany({
    where: { companyId: co.id, reference: { startsWith: tag } },
    select: { id: true, entryId: true },
  });
  await db.stockMovement.deleteMany({ where: { companyId: co.id, reference: { startsWith: tag } } });
  for (const r of rows) {
    if (!r.entryId) continue;
    await db.journalLine.deleteMany({ where: { entryId: r.entryId } });
    await db.journalEntry.delete({ where: { id: r.entryId } }).catch(() => {});
  }
  await db.item.deleteMany({ where: { companyId: co.id, code: { startsWith: tag } } });
  await db.store.deleteMany({ where: { companyId: co.id, code: { startsWith: tag } } });
}

/* ==================================================== how it is wired == */

const schema = read("prisma/schema.prisma");
ok("stock is a ledger of movements", /model StockMovement \{/.test(schema));
ok("  with no balance column anywhere",
  !/\bbalance\s+Float/.test(schema.slice(schema.indexOf("model StockMovement"))),
  "a stored balance drifts the moment a movement is reversed");
ok("an item knows whether it is even stocked", /isStocked\s+Boolean/.test(schema));

const policy = read("src/lib/financepolicy.ts");
for (const role of ["inventory", "goodsReceivedNotInvoiced", "materialCost"]) {
  ok(`${role} is a role, not a number in the code`, new RegExp(`key: "${role}"`).test(policy));
}
const seed = read("prisma/seed.mjs");
ok("and the chart carries the new accounts",
  /"2250", "Goods Received Not Invoiced"/.test(seed) && /"5200", "Site Materials"/.test(seed));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
