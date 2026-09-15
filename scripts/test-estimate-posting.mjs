/**
 * Building an estimate against a real database (CRM-05, CRM-06, CRM-07).
 *
 * The arithmetic is tested on its own in test-estimating.mjs. What matters
 * here is that the seam keeps its promises: no selling price is ever stored,
 * the takeoff beats the typed material figure the moment one exists, a lump
 * sum refuses to carry a quantity, and an estimate that is not fit to quote
 * from cannot be marked as though it were.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["estimate-posting", "estimating", "lead-posting", "db"]);
const { db } = libs["db"];
const {
  createEstimate, saveLine, removeLine, saveTakeoff, removeTakeoff,
  setBasis, markPriced, estimateWithTotals, priceEstimate, openEstimates,
  ESTIMATE_STATUSES, ESTIMATE_STATUS_HELP,
} = libs["estimate-posting"];
const { createLead } = libs["lead-posting"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

const co = await db.company.findFirst({ where: { code: "WBE" } });
const TAG = "EST-TEST";

try {
  ok("every status is explained in plain English",
    ESTIMATE_STATUSES.every((s) => (ESTIMATE_STATUS_HELP[s] || "").length > 25));

  const lead = await createLead({
    companyId: co.id, raisedBy: "Sales", title: `${TAG} enquiry`, customerName: "Emirates Steel",
    estimatedValue: 500000,
  });

  /* ============================================================ raising == */
  const made = await createEstimate({
    companyId: co.id, preparedBy: "Estimator", title: `${TAG} Substation fit-out`,
    leadId: lead.leadId, overheadPct: 0.1, basisKind: "markup", basisValue: 0.2,
  });
  ok("an estimate can be raised", made.ok, made.ok ? "" : made.error);
  ok("  numbered in its own series", /^WBE\/EST\/\d{2}\/\d{4}$/.test(made.number || ""), made.number);

  {
    const e = await db.estimate.findUnique({ where: { id: made.estimateId } });
    ok("  starting as a draft", e.status === "Draft");
    ok("  attached to the enquiry it prices", e.leadId === lead.leadId);
    ok("  and knowing WHICH percentage it was given", e.basisKind === "markup",
      "an estimate that does not say markup or margin cannot be checked later");
  }

  ok("an estimate with no title is refused",
    (await createEstimate({ companyId: co.id, preparedBy: "E", title: "  " })).ok === false);
  ok("negative overhead is refused",
    (await createEstimate({ companyId: co.id, preparedBy: "E", title: `${TAG} x`, overheadPct: -0.1 })).ok === false);

  /* ============================================================== lines == */
  let lineId;
  {
    const res = await saveLine({
      estimateId: made.estimateId, ref: "2.4.1", description: "Cable tray, 300mm",
      unit: "Metre", quantity: 100, labourHours: 0.5, labourRate: 24, materialCost: 40,
    });
    ok("a bill of quantities line can be added", res.ok, res.ok ? "" : res.error);
    lineId = res.lineId;

    const held = await estimateWithTotals(made.estimateId);
    ok("  costed from its build-up", held.totals.direct === 5200, String(held.totals.direct));
    ok("  with labour kept apart from material", held.totals.labour === 1200 && held.totals.material === 4000,
      `${held.totals.labour} / ${held.totals.material}`);
  }

  ok("a line with no description is refused",
    (await saveLine({ estimateId: made.estimateId, description: " ", unit: "Metre", quantity: 1 })).ok === false);
  ok("a line measured in nothing is refused",
    (await saveLine({ estimateId: made.estimateId, description: "x", unit: "Furlong", quantity: 1 })).ok === false);
  ok("a measured line with no quantity is refused",
    (await saveLine({ estimateId: made.estimateId, description: "x", unit: "Metre", quantity: 0 })).ok === false);
  ok("a negative cost is refused",
    (await saveLine({ estimateId: made.estimateId, description: "x", unit: "Metre", quantity: 1, materialCost: -5 })).ok === false);

  /**
   * The whole point of a lump sum.
   */
  {
    const res = await saveLine({
      estimateId: made.estimateId, description: "Commissioning package",
      unit: "Lump sum", quantity: 250, subcontractCost: 30000,
    });
    ok("a lump sum line needs no quantity", res.ok, res.ok ? "" : res.error);

    const row = await db.estimateLine.findUnique({ where: { id: res.lineId } });
    ok("  and stores one whatever was typed", row.quantity === 1, String(row.quantity));
    ok("  so it cannot be multiplied back into a rate", row.quantity !== 250);

    const held = await estimateWithTotals(made.estimateId);
    ok("  costing the package once", held.totals.subcontract === 30000, String(held.totals.subcontract));
  }

  /* ========================================================== takeoff === */
  {
    const res = await saveTakeoff({
      lineId, description: "Tray, 300mm", unitCode: "MTR", perUnit: 1, wastage: 0.05, unitCost: 40,
    });
    ok("a takeoff can be added to a line", res.ok, res.ok ? "" : res.error);

    await saveTakeoff({ lineId, description: "Brackets", unitCode: "EA", perUnit: 2, wastage: 0, unitCost: 6 });

    const held = await estimateWithTotals(made.estimateId);
    // 1 x 1.05 x 40 = 42, plus 2 x 6 = 12, so 54 per metre rather than the 40 typed.
    ok("the takeoff REPLACES the typed material figure", held.totals.material === 5400,
      `${held.totals.material} — 54 a metre from the takeoff, not the 40 somebody typed`);
    ok("  with wastage inside it", held.totals.material > 100 * 52,
      "52 a metre without wastage; the difference is what gets forgotten");

    const row = await db.estimateLine.findUnique({ where: { id: lineId } });
    ok("  and the typed figure is left alone rather than overwritten", row.materialCost === 40,
      "it is the fallback for lines nobody measures, and still true for those");
  }

  ok("a takeoff with no description is refused",
    (await saveTakeoff({ lineId, description: " ", perUnit: 1 })).ok === false);
  ok("a takeoff needing nothing per unit is refused",
    (await saveTakeoff({ lineId, description: "x", perUnit: 0 })).ok === false);

  {
    const r = await saveTakeoff({ lineId, description: "x", perUnit: 1, wastage: 5 });
    ok("wastage entered as a percentage rather than a fraction is refused", r.ok === false);
    ok("  and says how to enter it", /0\.05 for five per cent/.test(r.error), r.error);
  }

  {
    const res = await saveTakeoff({ lineId, description: "y", perUnit: 1, wastage: -0.5, unitCost: 10 });
    const row = await db.takeoffLine.findUnique({ where: { id: res.takeoffId } });
    ok("negative wastage is stored as none", row.wastage === 0,
      "an estimate cannot buy less than the drawings need");
    await removeTakeoff(res.takeoffId);
  }

  /* ====================================== overheads, then margin, in order */
  {
    const held = await estimateWithTotals(made.estimateId);
    const direct = held.totals.direct;
    ok("overhead is a share of the direct cost", near(held.totals.indirect, direct * 0.1),
      `${held.totals.indirect} of ${direct}`);
    ok("  and is part of what the work costs", held.totals.cost === direct + held.totals.indirect);

    /**
     * The order that decides whether a job pays.
     */
    const marginFirst = direct * 1.2 + held.totals.indirect;
    ok("the margin goes on after the overhead", held.totals.sell > marginFirst,
      `${held.totals.sell} against ${marginFirst.toFixed(2)} — the overhead would have come out of the profit`);

    ok("both percentages are reported", near(held.totals.markup, 0.2) && near(held.totals.margin, 0.1667),
      `${held.totals.markup} markup, ${held.totals.margin} margin`);
  }

  {
    await setBasis({ estimateId: made.estimateId, basisKind: "margin", basisValue: 0.2 });
    const held = await estimateWithTotals(made.estimateId);
    ok("switching to a margin basis gives the margin asked for", near(held.totals.margin, 0.2),
      String(held.totals.margin));
    ok("  which needs a bigger markup than 20%", held.totals.markup > 0.2, String(held.totals.markup));
    await setBasis({ estimateId: made.estimateId, basisKind: "markup", basisValue: 0.2 });
  }

  {
    const r = await setBasis({ estimateId: made.estimateId, basisKind: "margin", basisValue: 1 });
    ok("a hundred per cent margin is refused", r.ok === false);
    ok("  and explains why", /all profit and no cost/.test(r.error), r.error);
  }

  /* ================================================ nothing is stored === */
  {
    const columns = Object.keys(await db.estimate.findUnique({ where: { id: made.estimateId } }));
    ok("no selling price is stored on the estimate",
      !columns.some((c) => /^(sell|total|price|amount|margin|profit)$/i.test(c)),
      `columns: ${columns.join(", ")}`);

    const lineColumns = Object.keys(await db.estimateLine.findUnique({ where: { id: lineId } }));
    ok("  nor on its lines", !lineColumns.some((c) => /^(sell|total|price|rate|amount)$/i.test(c)),
      "a stored total is a total that was true when somebody last pressed save");
  }

  /* ============================================== fit to quote from ===== */
  {
    const empty = await createEstimate({ companyId: co.id, preparedBy: "E", title: `${TAG} empty` });
    const r = await markPriced(empty.estimateId);
    ok("an estimate with no lines cannot be marked priced", r.ok === false);
    ok("  and says what is missing", /at least one line/.test(r.error), r.error);
  }

  {
    const losing = await createEstimate({
      companyId: co.id, preparedBy: "E", title: `${TAG} losing`, basisKind: "markup", basisValue: -0.1,
    });
    await saveLine({
      estimateId: losing.estimateId, description: "Under cost", unit: "Metre", quantity: 100, materialCost: 10,
    });

    const r = await markPriced(losing.estimateId);
    ok("an estimate priced below cost cannot be marked priced", r.ok === false);
    ok("  saying by how much", /100 below what the work costs/.test(r.error), r.error);

    await setBasis({ estimateId: losing.estimateId, acceptLoss: true });
    const deliberate = await markPriced(losing.estimateId);
    ok("  unless somebody has said so deliberately", deliberate.ok, deliberate.ok ? "" : deliberate.error,
    );
  }

  {
    const res = await markPriced(made.estimateId);
    ok("a sound estimate can be marked priced", res.ok, res.ok ? "" : res.error);
    const e = await db.estimate.findUnique({ where: { id: made.estimateId } });
    ok("  and says so", e.status === "Priced");
  }

  /* ====================================================== posts nothing == */
  {
    const vouchers = await db.journalEntry.count({ where: { companyId: co.id, memo: { contains: TAG } } });
    ok("an estimate posts nothing to the ledger", vouchers === 0,
      "an opinion about what work will cost is not a transaction");
  }

  /* =========================================================== what is open */
  {
    const open = await openEstimates(co.id);
    ok("priced and draft estimates are both still open",
      open.filter((e) => e.title.startsWith(TAG)).length >= 2);
  }

  /* ============================================ a quoted estimate is shut */
  {
    await db.estimate.update({ where: { id: made.estimateId }, data: { status: "Quoted" } });
    const r = await removeLine(lineId);
    ok("a line cannot be removed once a quotation has gone out", r.ok === false);
    ok("  and says to copy it instead", /Copy it and change the copy/.test(r.error), r.error);
  }
} finally {
  await db.estimate.deleteMany({ where: { companyId: co.id, title: { startsWith: TAG } } });
  await db.lead.deleteMany({ where: { companyId: co.id, title: { startsWith: TAG } } });
}

/* ==================================================== how it is wired == */

const src = prose("src/lib/estimate-posting.ts");
ok("the file says why no total is stored",
  /an estimate is edited twenty times before it goes out/.test(src));
ok("and why the takeoff beats the typed figure",
  /Keeping both and hoping they agree/.test(src));
ok("and why it posts nothing",
  /nothing is owed and nothing is owned because somebody priced a job they have not won/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
