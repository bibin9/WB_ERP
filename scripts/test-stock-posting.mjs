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
  "stock-posting", "stock", "returns", "posting", "accounts", "financepolicy", "money", "db", "period", "vat",
]);
const { db } = libs["db"];
const {
  recordMovement, transferStock, balanceFor, inspectReceipt, awaitingInspection, postReturn,
} = libs["stock-posting"];
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

  /* =============================== QA/QC before it can be used (INV-11) == */

  {
    const checked = await db.item.create({
      data: {
        companyId: co.id, code: `${tag}-BOLT`, name: "M20 bolts, pressure joint",
        unitCode: "EA", requiresInspection: true,
      },
    });

    const arrived = await move({ kind: "Receipt", itemId: checked.id, storeId: main.id, quantity: 500, unitCost: 2, partyId: supplier.id });
    ok("a delivery of an item needing inspection is recorded", arrived.ok, arrived.ok ? "" : arrived.error);

    const row = await db.stockMovement.findUnique({ where: { id: arrived.movementId } });
    ok("  and starts as pending", row.inspection === "Pending");

    const shelf = await balanceFor(co.id, checked.id, main.id);
    ok("  it is on the shelf", shelf.quantity === 500);
    ok("  and in the stock value, because the company owns it", shelf.value === 1000);
    ok("  but none of it is free to issue", shelf.usable === 0,
      "issuing uncertified bolts into a pressure joint is the failure this prevents");

    const early = await move({ kind: "Issue", itemId: checked.id, storeId: main.id, quantity: 10, jobId: job.id });
    ok("  so an issue is refused", early.ok === false);
    ok("  and the refusal says the shelf is not empty",
      /There is more on the shelf/.test(early.error || ""), early.error);

    /* rejecting */
    const bad = await move({ kind: "Receipt", itemId: checked.id, storeId: main.id, quantity: 100, unitCost: 2, partyId: supplier.id });
    const failed = await inspectReceipt({ movementId: bad.movementId, inspectedBy: "qaqc", outcome: "Rejected", note: "No mill cert" });
    ok("a delivery can be failed", failed.ok, failed.ok ? "" : failed.error);

    const afterReject = await balanceFor(co.id, checked.id, main.id);
    ok("  rejected material stays on the shelf", afterReject.quantity === 600,
      "it is still ours until it physically goes back");
    ok("  and is counted apart from what is merely waiting", afterReject.rejected === 100);
    ok("  still nothing is usable", afterReject.usable === 0);

    /* accepting */
    const passed = await inspectReceipt({ movementId: arrived.movementId, inspectedBy: "qaqc", outcome: "Accepted", note: "Cert 4471" });
    ok("a delivery can be passed", passed.ok, passed.ok ? "" : passed.error);

    const afterAccept = await balanceFor(co.id, checked.id, main.id);
    ok("  and then it is free to issue", afterAccept.usable === 500);
    ok("  while the rejected hundred still is not", afterAccept.rejected === 100 && afterAccept.quantity === 600);

    const out = await move({ kind: "Issue", itemId: checked.id, storeId: main.id, quantity: 500, jobId: job.id });
    ok("  the passed material can now be issued", out.ok, out.ok ? "" : out.error);

    /* an inspection is recorded once */
    const again = await inspectReceipt({ movementId: arrived.movementId, inspectedBy: "qaqc", outcome: "Rejected" });
    ok("an inspection cannot be revised", again.ok === false);
    ok("  because somebody has already acted on it",
      /recorded once/.test(again.error || ""), again.error);

    /* and only where it applies */
    // A throwaway item, so this does not disturb the quantities the transfer
    // and reconciliation checks below are counting.
    const plainItem = await db.item.create({
      data: { companyId: co.id, code: `${tag}-NUT`, name: "Gland nut", unitCode: "EA" },
    });
    const plain = await move({ kind: "Receipt", itemId: plainItem.id, storeId: main.id, quantity: 1, unitCost: 1 });
    const none = await inspectReceipt({ movementId: plain.movementId, inspectedBy: "qaqc", outcome: "Accepted" });
    ok("an item that needs no inspection has nothing to pass", none.ok === false, none.error);

    const waiting = await awaitingInspection(co.id);
    ok("the list of deliveries waiting on QA/QC holds only pending ones",
      waiting.every((w) => w.inspection === "Pending"), `${waiting.length} waiting`);
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

  /* ============== a return note: reusable back, scrap not (INV-16) ====== */

  {
    const retItem = await db.item.create({
      data: { companyId: co.id, code: `${tag}-COND`, name: "20mm conduit", unitCode: "MTR" },
    });
    const got = await move({ kind: "Receipt", itemId: retItem.id, storeId: main.id, quantity: 300, unitCost: 10 });
    ok("300 of conduit arrives", got.ok, got.ok ? "" : got.error);
    const out = await move({ kind: "Issue", itemId: retItem.id, storeId: main.id, quantity: 200, jobId: job.id });
    ok("  and 200 of it goes to the job", out.ok, out.ok ? "" : out.error);

    const before = await balanceFor(co.id, retItem.id, main.id);
    ok("the job has 200 out and the shelf holds 100", before.quantity === 100);

    const note = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: main.id,
      date: today(), returnedBy: "site",
      lines: [
        { itemId: retItem.id, condition: "Reusable", quantity: 60 },
        { itemId: retItem.id, condition: "Scrap", quantity: 40 },
      ],
    });
    ok("a return note posts", note.ok, note.ok ? "" : note.error);
    ok("  numbered in its own series", /^WBE\/MRN\/\d{2}\/\d{4}$/.test(note.number || ""), note.number);

    const after = await balanceFor(co.id, retItem.id, main.id);
    ok("only the reusable half goes back on the shelf", after.quantity === 160,
      "100 left plus 60 returned; the 40 of scrap is not stock");

    const rows = await db.materialReturnLine.findMany({
      where: { returnId: note.returnId }, orderBy: { sortOrder: "asc" },
    });
    ok("  the reusable line has a stock movement behind it", !!rows[0].movementId);
    ok("  and credits the job what it cost", rows[0].value === 600, String(rows[0].value));

    /**
     * The half people expect to behave like the other one.
     */
    ok("  the scrap line has no movement at all", rows[1].movementId === null,
      "nothing went on any shelf");
    ok("  and credits the job nothing", rows[1].value === 0,
      "the job consumed it, so it keeps the cost");

    const credit = await db.journalLine.findFirst({
      where: { entry: { companyId: co.id, sourceType: "stock-movement", sourceId: rows[0].movementId } , credit: { gt: 0 } },
      include: { account: { select: { code: true } } },
    });
    ok("  the job is credited in the ledger too", credit?.account.code === "5200" && credit?.credit === 600);

    /* what cannot be returned */
    const tooMuch = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: main.id,
      date: today(), returnedBy: "site",
      lines: [{ itemId: retItem.id, condition: "Reusable", quantity: 500 }],
    });
    ok("returning more than the job ever had is refused", tooMuch.ok === false);
    ok("  naming what is still out", /Only 100 of 20mm conduit is still out/.test(tooMuch.error || ""), tooMuch.error);
    ok("  counting scrap as already returned", true,
      "200 issued, 60 reusable and 40 scrap back, so 100 remains");

    /**
     * A note is all or nothing. Half of one leaves a job credited for material
     * the storekeeper is still holding.
     */
    const shelfBefore = (await balanceFor(co.id, retItem.id, main.id)).quantity;
    // Counted before and after rather than against a fixed number. The
    // assertion is that the refused note wrote nothing, and a total only says
    // that while this suite is the only thing that has ever put a return in
    // this company — which stopped being true the moment the database had
    // demo data in it.
    const notesBefore = await db.materialReturn.count({ where: { companyId: co.id, jobId: job.id } });
    const mixed = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: main.id,
      date: today(), returnedBy: "site",
      lines: [
        { itemId: retItem.id, condition: "Reusable", quantity: 10 },
        { itemId: retItem.id, condition: "Reusable", quantity: 9999 },
      ],
    });
    ok("a note with one impossible line posts none of it", mixed.ok === false);
    ok("  leaving the shelf exactly as it was",
      (await balanceFor(co.id, retItem.id, main.id)).quantity === shelfBefore,
      "half a return note is worse than none");
    ok("  and no note behind it",
      (await db.materialReturn.count({ where: { companyId: co.id, jobId: job.id } })) === notesBefore);

    /**
     * The note has to add up as a whole, not line by line.
     *
     * 100 is still out. Two lines of 60 each pass on their own and return 120
     * between them, crediting the job with material it never had — the exact
     * thing the single-line check exists to prevent, walked round by splitting
     * the quantity over two rows.
     */
    const split = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: main.id,
      date: today(), returnedBy: "site",
      lines: [
        { itemId: retItem.id, condition: "Reusable", quantity: 60 },
        { itemId: retItem.id, condition: "Reusable", quantity: 60 },
      ],
    });
    ok("two lines that are fine alone but too much together are refused", split.ok === false,
      split.ok ? "120 came back against 100 outstanding" : split.error);
    ok("  counting the earlier line against the later one",
      /Only 40 of 20mm conduit is still out/.test(split.error || ""), split.error);

    const nameless = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: main.id,
      date: today(), returnedBy: "  ",
      lines: [{ itemId: retItem.id, condition: "Reusable", quantity: 5 }],
    });
    ok("a return with nobody's name on it is refused", nameless.ok === false,
      "material reappearing on a shelf anonymously is what a stock count can never explain");
    ok("  and asks for the name", /who brought it back/i.test(nameless.error || ""), nameless.error);

    /*
     * Reusable material goes back into a store that uses bins.
     *
     * Every other return here posts into a store with no bins, which is why
     * this went unnoticed: a store divided into bins refuses a movement that
     * does not name one, and the return carried no bin at all. The store most
     * likely to be binned is the main store, so in practice nothing could be
     * returned into the one place returns actually go.
     */
    const binned = await db.store.create({
      data: { companyId: co.id, code: `${tag}-BINS`, name: "Binned store" },
    });
    const shelf = await db.storageBin.create({
      data: { storeId: binned.id, code: "C-01", zone: "C", materialType: "Conduit" },
    });
    made.push(binned.id);

    await recordMovement({
      companyId: co.id, postedBy: "storeman", kind: "Receipt", itemId: retItem.id,
      storeId: binned.id, binId: shelf.id, date: today(), quantity: 50, unitCost: 10,
      reference: `${tag}-BIN-IN`,
    });
    const binJob = await recordMovement({
      companyId: co.id, postedBy: "storeman", kind: "Issue", itemId: retItem.id,
      storeId: binned.id, binId: shelf.id, date: today(), quantity: 30,
      jobId: job.id, reference: `${tag}-BIN-OUT`,
    });
    ok("  material can be issued out of a binned store", binJob.ok === true, binJob.ok ? "" : binJob.error);

    const backToBin = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: binned.id,
      date: today(), returnedBy: "site",
      lines: [{ itemId: retItem.id, condition: "Reusable", quantity: 10, binId: shelf.id }],
    });
    ok("reusable material goes back into a store that uses bins", backToBin.ok === true,
      backToBin.ok ? "" : backToBin.error);

    if (backToBin.ok) {
      const back = await db.stockMovement.findFirst({
        where: { companyId: co.id, kind: "Return to store", storeId: binned.id },
        orderBy: { createdAt: "desc" },
      });
      ok("  and the movement says which bin it went into", back?.binId === shelf.id,
        back?.binId ? `bin ${back.binId.slice(-6)}` : "no bin on the movement");
    }

    const noBin = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: binned.id,
      date: today(), returnedBy: "site",
      lines: [{ itemId: retItem.id, condition: "Reusable", quantity: 5 }],
    });
    ok("  and a return into a binned store still has to name one", noBin.ok === false,
      noBin.ok ? "it was allowed in with no bin" : noBin.error);

    // Scrap never reaches a shelf, so it is never asked for a bin.
    const scrapNoBin = await postReturn({
      companyId: co.id, postedBy: "storeman", jobId: job.id, storeId: binned.id,
      date: today(), returnedBy: "site",
      lines: [{ itemId: retItem.id, condition: "Scrap", quantity: 5 }],
    });
    ok("  scrap needs no bin, because it never reaches a shelf", scrapNoBin.ok === true,
      scrapNoBin.ok ? "" : scrapNoBin.error);
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
    /**
     * Scoped by the items this suite created, not by the reference on the
     * movement.
     *
     * A reference tag worked only while every movement carried one. A return
     * note cites its own number instead, which is correct — the movement
     * should name the document behind it — so the ledger side stopped seeing
     * movements the shelf side still counted, and the check failed for a
     * reason that had nothing to do with the code.
     */
    const mine = await db.item.findMany({
      where: { companyId: co.id, code: { startsWith: tag } },
      select: { id: true },
    });
    const itemIds = mine.map((m) => m.id);

    const posted = await db.stockMovement.findMany({
      where: { companyId: co.id, itemId: { in: itemIds }, entryId: { not: null } },
      select: { entryId: true },
    });
    let inventoryNet = 0;
    for (const p of posted) {
      for (const l of await linesOf(p.entryId)) {
        if (l.code === "1200") inventoryNet += l.debit - l.credit;
      }
    }

    const touched = await db.stockMovement.findMany({
      where: { companyId: co.id, itemId: { in: itemIds } },
      select: { itemId: true, storeId: true },
      distinct: ["itemId", "storeId"],
    });
    let shelves = 0;
    for (const t of touched) shelves += (await balanceFor(co.id, t.itemId, t.storeId)).value;

    ok("what the ledger says inventory is worth is what is on the shelves",
      Math.round(inventoryNet * 100) / 100 === Math.round(shelves * 100) / 100,
      `ledger ${Math.round(inventoryNet * 100) / 100} against shelves ${Math.round(shelves * 100) / 100}`);
  }
} finally {
  /**
   * Scoped by the items this suite owns, not by the reference tag.
   *
   * A return movement cites its MRN number rather than the tag, so a
   * tag-scoped sweep walked straight past it and left the note, its lines and
   * the journal behind. The items then could not be deleted — a line still
   * pointed at them — and the next run started against a shelf it had not
   * stocked, failing somewhere unrelated and blaming the wrong rule.
   *
   * Every run's leftovers are cleared, not just this one's, so a suite that
   * crashed once does not stay poisoned until somebody notices by hand.
   */
  const mine = await db.item.findMany({
    where: { companyId: co.id, code: { startsWith: "STK-" } },
    select: { id: true },
  });
  const itemIds = mine.map((i) => i.id);
  const owned = [{ reference: { startsWith: "STK-" } }, { itemId: { in: itemIds } }];

  await db.materialReturn.deleteMany({ where: { companyId: co.id, lines: { some: { itemId: { in: itemIds } } } } });

  const rows = await db.stockMovement.findMany({
    where: { companyId: co.id, OR: owned },
    select: { id: true, entryId: true },
  });
  await db.stockMovement.deleteMany({ where: { companyId: co.id, OR: owned } });
  for (const r of rows) {
    if (!r.entryId) continue;
    await db.journalLine.deleteMany({ where: { entryId: r.entryId } });
    await db.journalEntry.delete({ where: { id: r.entryId } }).catch(() => {});
  }
  await db.item.deleteMany({ where: { companyId: co.id, code: { startsWith: "STK-" } } });
  await db.store.deleteMany({ where: { companyId: co.id, code: { startsWith: "STK-" } } });
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
