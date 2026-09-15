/**
 * How a supplier has actually performed (INV-21, and INV-06's past-performance leg).
 *
 * The rules worth protecting, in order of how much damage getting them wrong does:
 *   - below MIN_HISTORY nothing is characterised at all, because dropping a
 *     supplier over a sample of one is a real thing that happens and is
 *     usually irreversible;
 *   - an order with no promised date is excluded rather than counted on time,
 *     or the suppliers with the worst paperwork come out best;
 *   - an open order is not late until its date has passed;
 *   - only inspected deliveries count towards a defect rate;
 *   - being cheapest of one is not a fact about the supplier.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { vendorrating } = await importLibs(["vendorrating"]);
const {
  MIN_HISTORY, rateDelivery, rateQuality, rateResponsiveness, ratePrice,
  summariseVendor, vendorVerdict, deliveryLabel,
} = vendorrating;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const order = (extra = {}) => ({
  expectedDate: "2026-01-10",
  orderedQuantity: 100,
  receivedQuantity: 100,
  lastReceiptDate: "2026-01-08",
  closed: true,
  ...extra,
});
const NOW = "2026-02-01";

/* ============================================================ delivery == */

{
  const r = rateDelivery([order(), order(), order()], NOW);
  ok("three orders delivered on time read as on time", r.otif === 3 && r.otifRate === 1);
  ok("  and that is enough history to say so", r.enough === true);
  ok("  with the count it is out of", r.considered === 3,
    "a rate without its denominator is what gets a supplier dropped over one bad week");
}

{
  const r = rateDelivery([order({ lastReceiptDate: "2026-01-14" }), order(), order()], NOW);
  ok("an order delivered after its date is late", r.onTime === 2 && r.otif === 2, `${r.otif} of ${r.considered}`);
  ok("  but still counts as in full", r.inFull === 3);
  ok("  so the two measures differ", r.otifRate !== r.inFullRate);
}

{
  const r = rateDelivery([order({ receivedQuantity: 60 }), order(), order()], NOW);
  ok("a short delivery is not in full", r.inFull === 2);
  ok("  and cannot be on time in full either", r.otif === 2,
    "half an order arriving on the day is not the order arriving on the day");
}

/**
 * The measure that would otherwise reward the worst paperwork.
 */
{
  const r = rateDelivery([order({ expectedDate: null }), order({ expectedDate: null }), order()], NOW);
  ok("an order with no promised date is excluded", r.considered === 1, String(r.considered));
  ok("  and counted separately so it is visible", r.undated === 2);
  ok("  never as on time", r.otifRate === 1 && r.otif === 1,
    "counting undated orders as on time makes the sloppiest supplier look perfect");
  ok("  and one order is not enough to judge on", r.enough === false);
}

/**
 * An order still running is not late yet.
 */
{
  const open = order({ closed: false, expectedDate: "2026-03-01", receivedQuantity: 0, lastReceiptDate: null });
  const r = rateDelivery([open, order(), order(), order()], NOW);
  ok("an open order not yet due is not judged", r.considered === 3,
    "marking it down would penalise a supplier who still has time");
}

{
  const overdue = order({ closed: false, expectedDate: "2026-01-05", receivedQuantity: 0, lastReceiptDate: null });
  const r = rateDelivery([overdue, order(), order()], NOW);
  ok("an open order past its date IS judged", r.considered === 3);
  ok("  and counts as late", r.otif === 2, `${r.otif} of ${r.considered}`);
}

ok("no orders at all is not enough history", rateDelivery([], NOW).enough === false);
ok("  and reads as nothing rather than nought per cent",
  rateDelivery([], NOW).considered === 0 && deliveryLabel(rateDelivery([], NOW)) === null);

ok("two orders is below the threshold", rateDelivery([order(), order()], NOW).enough === false,
  `MIN_HISTORY is ${MIN_HISTORY}`);
ok("  and no label is offered for them", deliveryLabel(rateDelivery([order(), order()], NOW)) === null,
  "returning null forces the caller to decide, rather than printing a judgement by accident");
ok("three is", deliveryLabel(rateDelivery([order(), order(), order()], NOW)) === "100% OTIF (3)",
  deliveryLabel(rateDelivery([order(), order(), order()], NOW)));

/* ============================================================= quality == */

{
  const r = rateQuality([
    { inspection: "Accepted" }, { inspection: "Accepted" },
    { inspection: "Rejected" }, { inspection: "Accepted" },
  ]);
  ok("the defect rate is rejections over inspections", r.rejected === 1 && r.inspected === 4);
  ok("  as a fraction", r.defectRate === 0.25, String(r.defectRate));
}

/**
 * Material that never needed inspecting says nothing about quality.
 */
{
  const r = rateQuality([
    { inspection: "Accepted" }, { inspection: "Rejected" }, { inspection: "Accepted" },
    { inspection: null }, { inspection: null }, { inspection: null }, { inspection: "Pending" },
  ]);
  ok("uninspected deliveries are left out", r.inspected === 3, String(r.inspected));
  ok("  so they cannot dilute a real defect rate", r.defectRate === round(1 / 3), String(r.defectRate));
  ok("  and pending is not an outcome yet", r.inspected === 3);
}

function round(n) { return Math.round(n * 1000) / 1000; }

ok("two inspections is not enough to call a defect rate",
  rateQuality([{ inspection: "Rejected" }, { inspection: "Accepted" }]).enough === false);

/* ====================================================== responsiveness == */

{
  const r = rateResponsiveness([
    { invitedAt: "2026-01-01", receivedAt: "2026-01-03" },
    { invitedAt: "2026-01-01", receivedAt: "2026-01-05" },
    { invitedAt: "2026-01-01", receivedAt: null },
  ]);
  ok("replies are counted against invitations", r.replied === 2 && r.asked === 3);
  ok("  as a rate", r.replyRate === 0.667, String(r.replyRate));
  ok("  with a typical speed", r.medianDays === 3, String(r.medianDays));
}

/**
 * One two-month reply must not describe a year of same-day answers.
 */
{
  const fast = [1, 1, 1, 1].map(() => ({ invitedAt: "2026-01-01", receivedAt: "2026-01-02" }));
  const r = rateResponsiveness([...fast, { invitedAt: "2026-01-01", receivedAt: "2026-03-02" }]);
  ok("the median ignores one outlier", r.medianDays === 1, String(r.medianDays));
  ok("  where the average would not", r.medianDays < 12,
    "the mean here is over twelve days, which describes the incident rather than the supplier");
}

ok("a supplier who never replied has no speed",
  rateResponsiveness([{ invitedAt: "2026-01-01", receivedAt: null }]).medianDays === null);
ok("  and no enquiries at all is not enough", rateResponsiveness([]).enough === false);

/* ============================================================== price === */

{
  const r = ratePrice([
    { total: 100, lowest: 100, competitors: 3 },
    { total: 110, lowest: 100, competitors: 3 },
    { total: 120, lowest: 100, competitors: 3 },
  ]);
  ok("being cheapest is counted", r.timesLowest === 1 && r.compared === 3);
  ok("  as a rate", r.lowestRate === 0.333, String(r.lowestRate));
  ok("  with how far above the lowest on average", r.averageAboveLowest === 0.1, String(r.averageAboveLowest));
}

/**
 * Cheapest of one is not a fact about the supplier.
 */
{
  const r = ratePrice([
    { total: 100, lowest: 100, competitors: 1 },
    { total: 100, lowest: 100, competitors: 1 },
    { total: 110, lowest: 100, competitors: 3 },
  ]);
  ok("a one-horse race is thrown out", r.compared === 1, String(r.compared));
  ok("  so it cannot be counted as a win", r.timesLowest === 0,
    "rewarding whoever quotes when nobody else does is not a price rating");
  ok("  and one comparison is not enough", r.enough === false);
}

/* ========================================================== together === */

{
  const rating = summariseVendor({ orders: [], receipts: [], invites: [], quotes: [], asOf: NOW });
  ok("a brand new supplier has no history", rating.anyHistory === false);
  ok("  and the sentence says exactly that",
    /Not enough history with this supplier yet/.test(vendorVerdict(rating)), vendorVerdict(rating));
}

{
  const rating = summariseVendor({
    orders: [order(), order(), order()],
    receipts: [{ inspection: "Accepted" }, { inspection: "Accepted" }, { inspection: "Accepted" }],
    invites: [
      { invitedAt: "2026-01-01", receivedAt: "2026-01-02" },
      { invitedAt: "2026-01-01", receivedAt: "2026-01-02" },
      { invitedAt: "2026-01-01", receivedAt: null },
    ],
    quotes: [
      { total: 100, lowest: 100, competitors: 3 },
      { total: 100, lowest: 100, competitors: 3 },
      { total: 100, lowest: 100, competitors: 3 },
    ],
    asOf: NOW,
  });
  const v = vendorVerdict(rating);
  ok("a supplier with history gets all four", rating.anyHistory === true);
  ok("  the delivery record", /100% on time and in full over 3 orders/.test(v), v);
  ok("  nothing rejected, said as words", /Nothing rejected in 3 inspected deliveries/.test(v), v);
  ok("  how often they reply", /Replied to 2 of 3 enquiries, typically in 1 day/.test(v), v);
  ok("  and that they are always cheapest", /Cheapest on all 3 comparisons/.test(v), v);
}

/**
 * The sentence must never print a figure it cannot stand behind.
 */
{
  const rating = summariseVendor({
    orders: [order({ lastReceiptDate: "2026-01-20" })],
    receipts: [], invites: [], quotes: [], asOf: NOW,
  });
  const v = vendorVerdict(rating);
  ok("one late order does not read as nought per cent", !/0%/.test(v), v);
  ok("  it says how few there were", /Only 1 completed order to judge delivery on/.test(v), v);
  ok("  and that it is too few to call", /too few to call/.test(v), v);
}

/* ==================================================== how it is written = */

const src = prose("src/lib/vendorrating.ts");
ok("the file says nothing is typed in by hand",
  /always five stars for whoever they like/.test(src));
ok("and why there is no single score",
  /people stop arguing with it/.test(src));
ok("and what showing a rate without its denominator costs",
  /nobody re-approves a vendor somebody else blacklisted/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
