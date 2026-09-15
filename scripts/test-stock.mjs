/**
 * Stock, and what it is worth.
 *
 * Three things carry this module and each fails quietly rather than loudly.
 * The average has to move on receipt and hold on issue. A store must never go
 * negative, because the first thing anybody does with a negative balance is
 * stop trusting the whole report. And an issue that empties the shelf has to
 * take the whole remaining value with it, or a few fils sit against a nil
 * quantity for ever and no amount of counting will explain them.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { stock } = await importLibs(["stock"]);
const {
  MOVEMENT_KINDS, MOVEMENT_HELP, INWARD, isInward, direction,
  balanceOf, priceReceipt, priceIssue, checkIssue, averageAfterReceipt,
  needsReorder, summariseStock, stockVerdict,
} = stock;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/** A movement, priced the way the module would price it. */
const receipt = (qty, cost) => ({ kind: "Receipt", ...priceReceipt(qty, cost) });
const issue = (qty, bal) => ({ kind: "Issue", ...priceIssue(qty, bal) });

/* ==================================================== which way it goes == */

ok("every kind is explained in plain English",
  MOVEMENT_KINDS.every((k) => (MOVEMENT_HELP[k] || "").length > 25), MOVEMENT_KINDS.join(", "));

ok("a receipt adds", isInward("Receipt") && direction("Receipt") === 1);
ok("an issue takes away", !isInward("Issue") && direction("Issue") === -1);
ok("material coming back adds", isInward("Return to store"));
ok("material going back to the supplier takes away", !isInward("Return to supplier"));
ok("a transfer does both, depending which end you are", isInward("Transfer in") && !isInward("Transfer out"));
ok("every kind is one or the other",
  MOVEMENT_KINDS.every((k) => isInward(k) === INWARD.has(k)));

/* ======================================================== the average === */

{
  const b = balanceOf([receipt(100, 10)]);
  ok("one receipt sets the average", b.quantity === 100 && b.value === 1000 && b.averageCost === 10);
}

/**
 * The whole point of weighted average. Cable bought at three prices is the same
 * cable on the drum, and the average has to move when a new price arrives.
 */
{
  const b = balanceOf([receipt(100, 10), receipt(100, 20)]);
  ok("a second receipt at a new price moves the average",
    b.quantity === 200 && b.value === 3000 && b.averageCost === 15);
}

{
  const first = balanceOf([receipt(100, 10), receipt(100, 20)]);
  const after = balanceOf([receipt(100, 10), receipt(100, 20), issue(50, first)]);
  ok("issuing does not move the average", after.averageCost === 15, String(after.averageCost));
  ok("  it takes quantity and value together",
    after.quantity === 150 && after.value === 2250, `${after.quantity} / ${after.value}`);
}

ok("an empty shelf has no average", balanceOf([]).averageCost === 0);
ok("and no value", balanceOf([]).value === 0);

ok("the effect of a delivery can be seen before it is saved",
  averageAfterReceipt(balanceOf([receipt(100, 10)]), 100, 20) === 15,
  "a delivery at twice the usual price moves everything already on the shelf");
ok("  and priced into an empty store it is simply the price",
  averageAfterReceipt(balanceOf([]), 10, 7.5) === 7.5);

/* ============================================ the rounding that strands == */

/**
 * Receive at prices whose average does not divide cleanly, then issue the lot.
 * Quantity times a rounded average would leave value behind on nil quantity —
 * a balance against nothing that no stock count can ever explain.
 */
{
  const movements = [receipt(3, 10), receipt(7, 3.333)];
  const before = balanceOf(movements);
  ok("the average does not divide cleanly", before.averageCost === 5.33, String(before.averageCost));

  /**
   * Asserted on the pricing itself, not on the balance.
   *
   * balanceOf zeroes the value when the quantity reaches nought, which is a
   * sensible net but it also hides this defect completely: priced wrongly, the
   * shelf still reads nil because the net corrected it. The rule has to be
   * checked where it lives.
   */
  const last = priceIssue(10, before);
  ok("an issue that empties the shelf takes the whole remaining value",
    last.value === before.value, `${last.value} against ${before.value} on hand`);
  ok("  rather than quantity times a rounded average",
    last.value !== round2(10 * before.averageCost),
    "which would be 53.30 and leave 0.03 stranded against nothing");

  const all = balanceOf([...movements, issue(10, before)]);
  ok("so the shelf reads nil on both counts", all.quantity === 0 && all.value === 0);
}

{
  // The same shape, one unit short of emptying it.
  const movements = [receipt(3, 10), receipt(7, 3.333)];
  const before = balanceOf(movements);
  const partial = balanceOf([...movements, issue(9, before)]);
  ok("a partial issue still leaves the right quantity", partial.quantity === 1);
  ok("  priced at the average, not at whatever is left", partial.value === round2(before.value - 9 * 5.33),
    String(partial.value));
}
function round2(n) { return Math.round(n * 100) / 100; }

ok("nil quantity is always nil value",
  balanceOf([receipt(5, 3.33), { kind: "Issue", quantity: 5, value: 16.66 }]).value === 0,
  "even when the two sides were priced a hair apart");

/* ------------------------------------------------- quantities are finer -- */
{
  const b = balanceOf([receipt(0.125, 800)]);
  ok("a fraction of a unit survives", b.quantity === 0.125 && b.value === 100,
    "0.001 of a tonne is a kilogram, so quantities carry more precision than money");
}

/* ===================================================== nothing negative == */

{
  const empty = balanceOf([]);
  const r = checkIssue(1, empty, "4-core cable");
  ok("issuing from an empty store is refused", r.ok === false);
  ok("  and the refusal names the item and says what to do",
    /4-core cable/.test(r.error) && /Receive it first/.test(r.error), r.error);
}

{
  const b = balanceOf([receipt(10, 5)]);
  const r = checkIssue(11, b, "conduit");
  ok("issuing more than is there is refused", r.ok === false);
  ok("  and the refusal says how much there is", /Only 10/.test(r.error), r.error);
  ok("issuing exactly what is there is allowed", checkIssue(10, b, "conduit").ok === true);
  ok("issuing less is allowed", checkIssue(1, b, "conduit").ok === true);
  ok("issuing nothing is refused", checkIssue(0, b, "conduit").ok === false);
  ok("issuing a negative is refused", checkIssue(-5, b, "conduit").ok === false);
}

/* ====================== on the shelf is not the same as usable (INV-11) == */

/**
 * The distinction the whole inspection rule turns on. Material waiting on
 * QA/QC is on the shelf and owned by the company, so it counts in the balance
 * and the ledger agrees. It is not free to use, and conflating the two is how
 * uncertified material gets welded into a line.
 */
const insp = (qty, cost, outcome) => ({ kind: "Receipt", ...priceReceipt(qty, cost), inspection: outcome });

{
  const b = balanceOf([insp(100, 10, "Pending")]);
  ok("material awaiting inspection is on the shelf", b.quantity === 100);
  ok("  and in the stock value, because the company owns it", b.value === 1000);
  ok("  but none of it is usable", b.usable === 0);
  ok("  and it is counted as waiting", b.awaitingInspection === 100);
}
{
  const b = balanceOf([insp(100, 10, "Accepted")]);
  ok("material that passed is usable", b.usable === 100 && b.awaitingInspection === 0);
}
{
  const b = balanceOf([insp(100, 10, "Rejected")]);
  ok("material that failed stays on the shelf", b.quantity === 100 && b.value === 1000,
    "it is still ours until it physically goes back");
  ok("  and is never usable", b.usable === 0);
  ok("  counted separately from the ones still waiting", b.rejected === 100 && b.awaitingInspection === 0);
}
{
  const b = balanceOf([receipt(50, 10)]);
  ok("an item that needs no inspection is usable on arrival", b.usable === 50,
    "not everything needs a QA/QC gate");
}
{
  const b = balanceOf([insp(100, 10, "Accepted"), insp(60, 10, "Pending"), insp(40, 10, "Rejected")]);
  ok("a mixed shelf reports all three", b.quantity === 200 && b.usable === 100);
  ok("  waiting and rejected add up to what is held back",
    b.awaitingInspection + b.rejected === 100);
}

/* ---------------------------------- and the issue check reads usable ---- */
{
  const b = balanceOf([insp(200, 10, "Pending")]);
  const r = checkIssue(50, b, "16mm cable");
  ok("nothing can be issued from an uninspected delivery", r.ok === false);
  ok("  and the refusal explains the shelf is not empty",
    /There is more on the shelf/.test(r.error), r.error);
  ok("  naming what is waiting on inspection",
    /200 waiting on inspection/.test(r.error), r.error);
}
{
  const b = balanceOf([insp(100, 10, "Accepted"), insp(100, 10, "Rejected")]);
  const r = checkIssue(150, b, "cable");
  ok("issuing beyond what passed is refused", r.ok === false);
  ok("  saying how much can actually be issued", /Only 100 of cable can be issued/.test(r.error), r.error);
  ok("  and why the rest cannot", /rejected and due back to the supplier/.test(r.error), r.error);
  ok("issuing what passed is allowed", checkIssue(100, b, "cable").ok === true);
}

/* ======================================================== the reporting == */

const item = (o) => ({
  itemId: o.id, code: o.code ?? "IT-01", name: o.name ?? "Item", unitCode: "EA",
  reorderLevel: o.reorder ?? 0,
  balance: balanceOf(o.movements ?? []),
});

{
  const rows = [
    item({ id: "a", code: "CBL-4C", reorder: 50, movements: [receipt(100, 10)] }),
    item({ id: "b", code: "CND-20", reorder: 50, movements: [receipt(40, 5)] }),
    item({ id: "c", code: "GLD-M20", movements: [] }),
  ];
  const t = summariseStock(rows);
  ok("every item is counted", t.items === 3);
  ok("only the ones with stock are stocked", t.stocked === 2);
  ok("the value totals", t.value === 1200, String(t.value));
  ok("and the ones needing reordering are found", t.belowReorder === 1, "40 against a level of 50");

  ok("an item with no reorder level is never chased",
    !needsReorder(rows[2]), "nought means nobody set one, not order immediately");
  ok("one at its level is chased", needsReorder(rows[1]));
}

/* ------------------------------------------------------------ verdict --- */
ok("an empty store says what to do", /No items yet/.test(stockVerdict([])));

{
  const rows = [item({ id: "a", movements: [receipt(100, 10)] })];
  ok("a healthy store states its value", /1,000\.00 of stock on hand/.test(stockVerdict(rows)), stockVerdict(rows));
  // "across 1 items" is the kind of thing a reader notices and a writer does not.
  ok("  counting one item reads as one", /across 1 item\./.test(stockVerdict(rows)), stockVerdict(rows));
  const two = [...rows, item({ id: "b", movements: [receipt(5, 2)] })];
  ok("  and two read as two", /across 2 items\./.test(stockVerdict(two)), stockVerdict(two));
}
{
  const rows = [item({ id: "a", reorder: 50, movements: [receipt(40, 10)] })];
  ok("and names what needs reordering", /at or below the reorder level/.test(stockVerdict(rows)));
}
{
  const rows = [item({ id: "a", movements: [] }), item({ id: "b", movements: [] })];
  ok("items set up with no stock say so", /none has any stock on hand/.test(stockVerdict(rows)), stockVerdict(rows));
  ok("  and one of them reads as one",
    /^1 item is set up/.test(stockVerdict([item({ id: "a", movements: [] })])),
    stockVerdict([item({ id: "a", movements: [] })]));
}

/**
 * A negative balance means the record and the shelf have already parted
 * company, so it outranks everything else on the screen.
 */
{
  const rows = [
    item({ id: "a", movements: [receipt(100, 10)] }),
    { itemId: "b", code: "X", name: "X", unitCode: "EA", reorderLevel: 0,
      balance: { quantity: -5, value: -50, averageCost: 0 } },
  ];
  const v = stockVerdict(rows);
  ok("a negative balance leads the sentence", /less than nothing in stock/.test(v), v);
  ok("  and says what to do about it", /count the shelf and adjust/.test(v));
  ok("  and it is counted", summariseStock(rows).negative === 1);
}

/* ==================================================== how it is written == */

const src = read("src/lib/stock.ts");
ok("the balance is derived, never stored",
  !/stored balance|balance: Float/.test(src) && /derived/.test(src),
  "a stored balance drifts the moment a movement is reversed");
ok("the valuation method is written down, with why",
  /[Ww]eighted average/.test(src) && /FIFO/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
