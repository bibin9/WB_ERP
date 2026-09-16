/**
 * Pricing the work (CRM-05, CRM-06, CRM-07).
 *
 * Four rules, each a way contractors lose money quietly:
 *   - margin is not markup, and both are always shown;
 *   - overheads go on BEFORE the margin, or they come out of it;
 *   - the rate comes from the build-up and cannot be typed over;
 *   - wastage is part of the takeoff, or the estimate is short before the
 *     job starts.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { estimating: lib } = await importLibs(["estimating"]);
const {
  BID_UNITS, BID_UNIT_HELP, isLumpSum,
  markupToMargin, marginToMarkup, sellFrom,
  buildUp, takeoff, materialPerUnit, bidLine, summariseEstimate, estimateVerdict, checkQuotable,
} = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

/* ================================================== what the words mean == */

ok("every bid unit is explained in plain English",
  BID_UNITS.every((u) => (BID_UNIT_HELP[u] || "").length > 25), BID_UNITS.join(", "));
ok("the BRD's four units are all there",
  ["Tonne", "Metre", "Piece", "Lump sum"].every((u) => BID_UNITS.includes(u)));

ok("a lump sum is a lump sum", isLumpSum("Lump sum") === true);
ok("a metre is not", isLumpSum("Metre") === false);

/* ============================== the mistake this module exists to stop == */

/**
 * The single most expensive confusion in estimating.
 */
ok("a 20% markup is a 16.67% margin", near(markupToMargin(0.2), 0.1667),
  `${markupToMargin(0.2)} — on a two million job that gap is real money`);
ok("a 20% margin needs a 25% markup", near(marginToMarkup(0.2), 0.25), String(marginToMarkup(0.2)));
ok("  and the two are genuinely different numbers", markupToMargin(0.2) !== marginToMarkup(0.2));

ok("they round-trip", near(markupToMargin(marginToMarkup(0.3)), 0.3),
  "a margin turned into a markup and back is the margin you started with");
ok("  in the other direction too", near(marginToMarkup(markupToMargin(0.45)), 0.45));

ok("nothing added is nothing either way", markupToMargin(0) === 0 && marginToMarkup(0) === 0);

/**
 * The impossible ones, which must not produce Infinity and a quote nobody can
 * explain.
 */
ok("a 100% margin is refused rather than infinite", marginToMarkup(1) === 0,
  "the selling price would be all profit and no cost, which is not a thing");
ok("  and beyond it too", marginToMarkup(1.5) === 0);
ok("a markup of -100% does not divide by zero", markupToMargin(-1) === 0);

/* ======================================================== selling price == */

ok("a markup multiplies the cost", sellFrom(100, { markup: 0.2 }) === 120);
ok("a margin divides into the price", sellFrom(100, { margin: 0.2 }) === 125,
  "100 / (1 - 0.2), so the profit really is a fifth of what is charged");

{
  const sell = sellFrom(100, { margin: 0.2 });
  ok("  which gives the margin actually asked for", near((sell - 100) / sell, 0.2),
    `${((sell - 100) / sell).toFixed(4)}`);
}
{
  const sell = sellFrom(100, { markup: 0.2 });
  ok("  where the markup would have given less", near((sell - 100) / sell, 0.1667),
    "quoting 20% and meaning markup delivers 16.67%");
}

ok("a 100% margin sells for nothing rather than infinity", sellFrom(100, { margin: 1 }) === 0);

/* ========================================================= the build-up == */

{
  const b = buildUp({
    materialCost: 40, labourHours: 2, labourRate: 25, plantHours: 0.5, plantRate: 60, subcontractCost: 10,
  });
  ok("material is taken as given", b.material === 40);
  ok("labour is hours times a rate", b.labour === 50, String(b.labour));
  ok("plant likewise", b.plant === 30, String(b.plant));
  ok("subcontract is taken as given", b.subcontract === 10);
  ok("  and the unit cost is the sum of them", b.total === 130, String(b.total));
}

ok("an empty build-up costs nothing, not NaN",
  buildUp({}).total === 0 && Number.isFinite(buildUp({}).total));
ok("hours with no rate cost nothing", buildUp({ labourHours: 8 }).labour === 0);
ok("a rate with no hours costs nothing", buildUp({ labourRate: 25 }).labour === 0);

/* ============================================================= takeoff == */

{
  const t = takeoff(100, { perUnit: 1, wastage: 0.05, unitCost: 12 });
  ok("the net is what the drawings say", t.net === 100);
  ok("the gross is what has to be bought", t.gross === 105,
    "a hundred metres of tray does not need a hundred metres of tray");
  ok("  with the difference kept", t.wasted === 5,
    "five per cent on structural steel is a week of somebody's wages");
  ok("  and costed on the gross", t.cost === 1260, String(t.cost));
}

{
  const t = takeoff(100, { perUnit: 2.5, wastage: 0, unitCost: 4 });
  ok("a takeoff can need more than one unit per item", t.net === 250 && t.gross === 250);
  ok("  with no wastage when none is set", t.wasted === 0);
}

ok("negative wastage is treated as none",
  takeoff(100, { perUnit: 1, wastage: -0.5, unitCost: 1 }).gross === 100,
  "an estimate cannot buy less than the drawings need");

/* ================================= material from the takeoff (CRM-05) == */

{
  // One metre of tray: 1.05 m of tray at 40, plus 2 brackets at 6.
  const per = materialPerUnit([
    { perUnit: 1, wastage: 0.05, unitCost: 40 },
    { perUnit: 2, wastage: 0, unitCost: 6 },
  ]);
  ok("material per unit comes from the takeoff", per === 54, String(per));
  ok("  with wastage inside it", per > 1 * 40 + 2 * 6,
    "52 without wastage, 54 with — and that two is what gets forgotten");
}

ok("a line with no takeoff has no material from one", materialPerUnit([]) === 0);
ok("negative wastage does not reduce what must be bought",
  materialPerUnit([{ perUnit: 1, wastage: -0.5, unitCost: 100 }]) === 100);

{
  const per = materialPerUnit([{ perUnit: 1, wastage: 0.05, unitCost: 40 }]);
  const line = bidLine({ unit: "Metre", quantity: 100, build: { materialCost: per, labourHours: 0.5, labourRate: 24 } });
  ok("and it feeds the build-up like any other material figure", line.unitCost === 54, String(line.unitCost));
  ok("  multiplying out over the quantity", line.cost === 5400, String(line.cost));
}

/* ============================================================ bid line == */

{
  const l = bidLine({ unit: "Metre", quantity: 100, build: { materialCost: 10, labourHours: 1, labourRate: 20 } });
  ok("a measured line multiplies out", l.cost === 3000, String(l.cost));
  ok("  at a unit cost from the build-up", l.unitCost === 30);
}

/**
 * The whole point of a lump sum.
 */
{
  const l = bidLine({ unit: "Lump sum", quantity: 250, build: { subcontractCost: 80000 } });
  ok("a lump sum ignores whatever quantity was typed", l.quantity === 1, String(l.quantity));
  ok("  and costs the package once", l.cost === 80000, String(l.cost),
  );
  ok("  because the customer is buying an outcome, not a measurement", l.cost !== 250 * 80000);
}

/* ============================ the order that decides whether a job pays == */

{
  // 1,000 direct. 10% overhead = 100. Cost 1,100. 20% markup = 1,320.
  const lines = [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }];
  const t = summariseEstimate(lines, { overheadPct: 0.1 }, { kind: "markup", value: 0.2 });

  ok("direct cost comes from the lines", t.direct === 1000, String(t.direct));
  ok("overhead is a share of direct cost", t.indirect === 100, String(t.indirect));
  ok("  and is part of what the work costs", t.cost === 1100, String(t.cost));
  ok("the margin goes on AFTER the overhead", t.sell === 1320, String(t.sell));

  /**
   * The failure this order prevents.
   */
  const marginFirst = 1000 * 1.2 + 100; // 1,300 — what applying margin first gives
  ok("  which is more than applying it first would give", t.sell > marginFirst,
    `${t.sell} against ${marginFirst}: the overhead would have come out of the profit`);

  ok("profit is what is left", t.profit === 220, String(t.profit));
  ok("  reported as a margin", near(t.margin, 0.1667), String(t.margin));
  ok("  and as the markup it actually was", near(t.markup, 0.2), String(t.markup));
}

{
  const lines = [{ unit: "Lump sum", build: { subcontractCost: 1000 } }];
  const t = summariseEstimate(lines, { fixedCosts: 500 }, { kind: "margin", value: 0.25 });
  ok("fixed costs are indirect too", t.indirect === 500);
  ok("  and a margin basis divides into the price", t.sell === 2000, String(t.sell));
  ok("  giving exactly the margin asked for", near(t.margin, 0.25), String(t.margin));
}

{
  const t = summariseEstimate([
    { unit: "Metre", quantity: 10, build: { materialCost: 5, labourHours: 1, labourRate: 20, plantHours: 0.5, plantRate: 40, subcontractCost: 15 } },
  ]);
  ok("the estimate keeps the four costs apart", t.material === 50 && t.labour === 200,
    `${t.material} / ${t.labour}`);
  ok("  including plant", t.plant === 200, String(t.plant));
  ok("  and subcontract", t.subcontract === 150, String(t.subcontract));
  ok("  adding to the direct cost", t.direct === 600, String(t.direct));
}

ok("an empty estimate costs nothing and is not NaN",
  summariseEstimate([]).cost === 0 && summariseEstimate([]).margin === 0);
ok("  with no markup either", summariseEstimate([]).markup === 0);

/* ====================================================== fit to quote == */

ok("an estimate with no lines cannot be quoted", checkQuotable(summariseEstimate([])).ok === false);

{
  const t = summariseEstimate([{ unit: "Metre", quantity: 1, build: {} }]);
  const r = checkQuotable(t);
  ok("an estimate with nothing costed cannot be quoted", r.ok === false);
  ok("  and says so", /Nothing has been costed/.test(r.error), r.error);
}

{
  const t = summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }],
    {},
    { kind: "markup", value: -0.1 },
  );
  const r = checkQuotable(t);
  ok("a price below cost is refused", r.ok === false);
  ok("  saying by how much", /100 below what the work costs/.test(r.error), r.error);
  ok("  and offering the honest way through", /loss leader/.test(r.error), r.error);
  ok("  which can be taken deliberately", checkQuotable(t, true).ok === true,
    "a loss leader is a decision somebody is allowed to make, once they have said so");
}

ok("a sound estimate is quotable",
  checkQuotable(summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "markup", value: 0.2 },
  )).ok === true);

/* ========================================================= the sentence == */

ok("an empty estimate says so", /Nothing priced yet/.test(estimateVerdict(summariseEstimate([]))));

{
  const v = estimateVerdict(summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }],
    { overheadPct: 0.1 },
    { kind: "markup", value: 0.2 },
  ));
  ok("the sentence gives both percentages in the same breath",
    /16\.7% margin, which is 20\.0% markup/.test(v), v);
  ok("  so the confusion cannot survive reading it", /margin/.test(v) && /markup/.test(v));
  ok("  and says the overhead went on before the margin",
    /overhead, added before the margin/.test(v), v);
}

{
  const v = estimateVerdict(summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "markup", value: -0.2 },
  ));
  ok("an estimate below cost says the job loses money", /the job loses money/.test(v), v);
}

/* ============================== hours, for the job budget that follows == */

{
  const t = summariseEstimate([
    { unit: "Metre", quantity: 100, build: { labourHours: 0.5, labourRate: 20, plantHours: 0.1, plantRate: 100 } },
    { unit: "Piece", quantity: 20, build: { labourHours: 2, labourRate: 20 } },
  ]);
  ok("labour hours are carried across the estimate", t.labourHours === 90, String(t.labourHours));
  ok("  and plant hours separately", t.plantHours === 10, String(t.plantHours));
  ok("  because a job budget needs hours as well as money",
    t.labourHours > 0 && t.labour > 0 && t.labourHours !== t.labour);
}

{
  const t = summariseEstimate([{ unit: "Lump sum", quantity: 999, build: { labourHours: 40, labourRate: 20 } }]);
  ok("a lump sum contributes its hours once", t.labourHours === 40, String(t.labourHours));
}

ok("an empty estimate has no hours", summariseEstimate([]).labourHours === 0);

/* ============================== boundaries, found by mutation testing == */

/**
 * Break-even is not a loss, and must not read like one.
 */
{
  const even = summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "markup", value: 0 },
  );
  ok("quoting at exactly cost makes nothing", even.profit === 0, String(even.profit));
  ok("  and the sentence says so", /the job makes nothing/.test(estimateVerdict(even)), estimateVerdict(even));
  ok("  rather than calling it a loss", !/loses money/.test(estimateVerdict(even)));
  ok("  and it can still be quoted", checkQuotable(even).ok === true,
    "selling at cost is a decision somebody is allowed to take");
}

{
  const under = summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "markup", value: -0.01 },
  );
  ok("a single dirham below cost IS a loss", /loses money/.test(estimateVerdict(under)), estimateVerdict(under));
  ok("  and is refused", checkQuotable(under).ok === false);
}

/**
 * A hundred per cent margin sells for nothing, and -cost/0 is -Infinity.
 */
{
  const t = summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "margin", value: 1 },
  );
  ok("a selling price of nil does not produce an infinite margin",
    Number.isFinite(t.margin) && t.margin === 0, String(t.margin));
  ok("  nor an infinite markup", Number.isFinite(t.markup), String(t.markup));
}

{
  const t = summariseEstimate([{ unit: "Metre", quantity: 1, build: {} }]);
  const v = estimateVerdict(t);
  ok("an estimate with lines but no cost says exactly that",
    /1 line, and nothing costed yet/.test(v), v);
  ok("  rather than quoting a price of nothing", !/quote 0/.test(v), v);
}

{
  const v = estimateVerdict(summariseEstimate(
    [{ unit: "Metre", quantity: 100, build: { materialCost: 10 } }], {}, { kind: "markup", value: 0.2 },
  ));
  ok("an estimate with no overhead says nothing about overhead", !/overhead/.test(v), v);
}

{
  const v = estimateVerdict(summariseEstimate(
    [{ unit: "Metre", quantity: 1, build: { materialCost: 10 } }, { unit: "Metre", quantity: 1, build: {} }],
    {}, { kind: "markup", value: 0.2 },
  ));
  ok("two lines read as two", /Costs 10, quote 12/.test(v), v);
}

/* ==================================================== how it is written = */

const src = prose("src/lib/estimating.ts");
ok("the file says what the margin confusion costs",
  /sixty-seven thousand dirhams of profit that was never there/.test(src));
ok("and why overheads go on first",
  /the estimate still shows twenty per cent and the job returns four/.test(src));
ok("and why a rate cannot be typed over the build-up",
  /the build-up is decoration/.test(src));
ok("and why wastage belongs in the takeoff",
  /short before work starts/.test(src));

/*
 * An estimate says what has been quoted from it.
 *
 * The link ran one way: a quotation named its estimate, and the estimate said
 * nothing back. An estimator could open a priced estimate, change the rates,
 * and never learn that a quotation went out weeks ago, the customer accepted
 * it, and a job is running to a budget taken from these figures. The
 * customer's copy is safe — a quotation snapshots its own price — but the
 * estimator was editing blind, and afterwards the estimate no longer explains
 * the budget on the job.
 */
{
  const page = fs.readFileSync("src/app/(app)/crm/estimates/[id]/page.tsx", "utf8");
  ok("an estimate loads the quotations raised from it",
    /db\.quotation\.findMany\(\{\s*where: \{ estimateId: estimate\.id \}/.test(page));
  ok("  and links to each one", /\/crm\/quotations\/\$\{q\.id\}/.test(page));
  ok("  showing the job it was won as", /won as job/.test(page));
  ok("  and warns once one has been issued or accepted",
    /\["Issued", "Accepted"\]\.includes\(q\.status\)/.test(page) &&
      /will not change what the customer is holding/.test(page));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
