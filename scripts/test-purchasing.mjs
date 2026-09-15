/**
 * Ordering material, and knowing what has actually turned up.
 *
 * Two rules carry this and both are the reason the document exists at all.
 * Nothing may be received against an order nobody has approved, or the
 * approval route is decoration. And how much has arrived is summed from the
 * receipts rather than stored, so an order cannot claim to be complete when it
 * is not.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { purchasing } = await importLibs(["purchasing"]);
const {
  PO_STATUSES, PO_STATUS_HELP, REQUEST_STATUSES, REQUEST_STATUS_HELP, RECEIVABLE, CLOSED,
  lineTotal, orderTotal, lineProgress, statusFromReceipts, checkReceipt,
  orderState, summarisePurchasing, purchasingVerdict,
} = purchasing;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
const rcpt = (...qs) => qs.map((quantity) => ({ quantity }));

/* ================================================== what the words mean == */

ok("every order status is explained in plain English",
  PO_STATUSES.every((s) => (PO_STATUS_HELP[s] || "").length > 25), PO_STATUSES.join(", "));
ok("and every request status too",
  REQUEST_STATUSES.every((s) => (REQUEST_STATUS_HELP[s] || "").length > 20));

ok("only an approved order can be received against",
  RECEIVABLE.has("Approved") && RECEIVABLE.has("Partly received"));
ok("  a draft cannot", !RECEIVABLE.has("Draft"));
ok("  nor one awaiting approval", !RECEIVABLE.has("Awaiting approval"),
  "the approval gate is the whole reason the document exists");
ok("  nor a rejected or cancelled one",
  !RECEIVABLE.has("Rejected") && !RECEIVABLE.has("Cancelled"));
ok("a settled order is closed", CLOSED.has("Received") && CLOSED.has("Rejected") && CLOSED.has("Cancelled"));
ok("  and nothing is both receivable and closed",
  PO_STATUSES.every((s) => !(RECEIVABLE.has(s) && CLOSED.has(s))));

/* ======================================================== the arithmetic = */

{
  const l = lineTotal({ description: "Cable", quantity: 250, unitPrice: 12.5 });
  ok("a line is quantity times price", l.netAmount === 3125);
  ok("  quantities keep three places", lineTotal({ quantity: 0.125, unitPrice: 800 }).quantity === 0.125);
  ok("  and money keeps two", lineTotal({ quantity: 3, unitPrice: 3.333 }).unitPrice === 3.33);
}

ok("an order totals its lines",
  orderTotal([{ quantity: 10, unitPrice: 5 }, { quantity: 2, unitPrice: 7.5 }]) === 65);
ok("an empty order is worth nothing", orderTotal([]) === 0);

/**
 * An order is a commitment to buy, not a tax document. The tax point is the
 * supplier's invoice, and a VAT figure on an order invites somebody to reclaim
 * tax on a document the FTA has never seen.
 */
{
  const src = read("src/lib/purchasing.ts");
  ok("an order carries no VAT, and says why", /No VAT/.test(src) && /tax point is/.test(src));
}

/* ================================================= what has arrived ====== */

ok("nothing received is everything outstanding",
  lineProgress(100, []).outstanding === 100 && lineProgress(100, []).received === 0);

{
  const p = lineProgress(100, rcpt(30, 20));
  ok("receipts add up", p.received === 50);
  ok("  and the rest is outstanding", p.outstanding === 50);
  ok("  which is not complete", p.complete === false);
  ok("  and is half done", p.share === 0.5);
}

{
  const p = lineProgress(100, rcpt(60, 40));
  ok("everything received is complete", p.complete === true && p.outstanding === 0);
}

/**
 * An over-receipt is refused when entered, but if one ever got through the
 * order must read as nothing left rather than as a negative order.
 */
{
  const p = lineProgress(100, rcpt(120));
  ok("an over-receipt never leaves a negative outstanding", p.outstanding === 0);
  ok("  and is flagged rather than hidden", p.over === true);
  ok("  with the share capped", p.share === 1);
}

ok("a line ordered as nothing is not complete", lineProgress(0, []).complete === false,
  "or an empty line would mark a whole order received");

/* =============================================== the status follows ====== */

const line = (quantity, received = []) => ({ quantity, unitPrice: 10, receipts: received });

ok("an approved order with nothing received stays approved",
  statusFromReceipts("Approved", [line(100)]) === "Approved");
ok("one with something received is partly received",
  statusFromReceipts("Approved", [line(100, rcpt(40))]) === "Partly received");
ok("one with everything received is received",
  statusFromReceipts("Approved", [line(100, rcpt(100))]) === "Received");
ok("  and every line has to be complete, not just one",
  statusFromReceipts("Approved", [line(100, rcpt(100)), line(50)]) === "Partly received",
  "the second line is still outstanding");

/**
 * A draft, a rejection and a cancellation are decisions rather than
 * observations, so no amount of material arriving moves them.
 */
for (const fixed of ["Draft", "Awaiting approval", "Rejected", "Cancelled"]) {
  ok(`${fixed.toLowerCase()} is not moved by receipts`,
    statusFromReceipts(fixed, [line(100, rcpt(100))]) === fixed);
}
ok("an order with no lines is left alone", statusFromReceipts("Approved", []) === "Approved");

/* ================================================ the approval gate ====== */

{
  const r = checkReceipt("Awaiting approval", 100, [], 10, "cable");
  ok("receiving against an unapproved order is refused", r.ok === false);
  ok("  and says what is missing", /waiting for approval/.test(r.error), r.error);
}
{
  const r = checkReceipt("Draft", 100, [], 10);
  ok("a draft order refuses too", r.ok === false);
  ok("  telling you it was never sent", /not been sent for approval/.test(r.error), r.error);
}
{
  const r = checkReceipt("Cancelled", 100, [], 10);
  ok("a cancelled order refuses", r.ok === false && /cancelled/.test(r.error), r.error);
}

ok("an approved order accepts a receipt", checkReceipt("Approved", 100, [], 40, "cable").ok === true);
ok("a partly received one accepts the rest",
  checkReceipt("Partly received", 100, rcpt(40), 60, "cable").ok === true);

{
  const r = checkReceipt("Approved", 100, rcpt(80), 30, "cable");
  ok("receiving more than is outstanding is refused", r.ok === false);
  ok("  naming what is left", /Only 20 of cable/.test(r.error), r.error);
  ok("  and suggesting the amendment rather than a silent over-receipt",
    /amend the order/.test(r.error));
}
{
  const r = checkReceipt("Approved", 100, rcpt(100), 1, "cable");
  ok("nothing can be received against a finished line", r.ok === false);
  ok("  and it says so plainly", /already been received/.test(r.error), r.error);
}
ok("a nil receipt is refused", checkReceipt("Approved", 100, [], 0).ok === false);
ok("a negative receipt is refused", checkReceipt("Approved", 100, [], -5).ok === false);

/* ==================================================== the whole order ==== */

const order = (o) => ({
  status: o.status ?? "Approved",
  total: o.total ?? 0,
  expectedDate: o.expectedDate ?? null,
  lines: o.lines ?? [],
});

{
  const o = order({
    total: 1500,
    lines: [
      { quantity: 100, unitPrice: 10, receipts: rcpt(40) },
      { quantity: 50, unitPrice: 10, receipts: [] },
    ],
  });
  const s = orderState(o);
  ok("value received is priced at the order", s.receivedValue === 400);
  ok("  and the rest is outstanding", s.outstandingValue === 1100);
  ok("  which is not complete", s.complete === false);
}

{
  const late = order({
    total: 1000,
    expectedDate: "2026-09-01",
    lines: [{ quantity: 100, unitPrice: 10, receipts: [] }],
  });
  const s = orderState(late, new Date("2026-09-14T00:00:00.000Z"));
  ok("an order past its promised date is overdue", s.overdue === true);
  ok("  by the right number of days", s.daysLate === 13, String(s.daysLate));
}
{
  const done = order({
    status: "Received",
    expectedDate: "2026-09-01",
    lines: [{ quantity: 100, unitPrice: 10, receipts: rcpt(100) }],
  });
  ok("a finished order is never overdue",
    orderState(done, new Date("2026-09-14T00:00:00.000Z")).overdue === false);
}
{
  const noDate = order({ lines: [{ quantity: 100, unitPrice: 10, receipts: [] }] });
  ok("an order with no promised date is never late", orderState(noDate).overdue === false,
    "nobody promised anything, so nothing was missed");
}

/* ======================================================== the register === */

{
  const rows = [
    order({ status: "Awaiting approval", total: 5000, lines: [{ quantity: 10, unitPrice: 500, receipts: [] }] }),
    order({ status: "Approved", total: 1000, lines: [{ quantity: 100, unitPrice: 10, receipts: rcpt(40) }] }),
    order({ status: "Received", total: 2000, lines: [{ quantity: 200, unitPrice: 10, receipts: rcpt(200) }] }),
  ];
  const t = summarisePurchasing(rows);
  ok("every order is counted", t.orders === 3);
  ok("the ones waiting for approval are named", t.awaitingApproval === 1);
  ok("only receivable orders are open", t.open === 1,
    "one awaiting approval and one received are not");
  ok("committed is what is ordered and not settled", t.committed === 1000);
  ok("outstanding value is what has not arrived", t.outstandingValue === 600);
}

/* ======================================================== the sentence === */

ok("an empty register says what to do", /Raise one when material needs ordering/.test(purchasingVerdict([])));

{
  const waiting = [order({ status: "Awaiting approval", total: 500, lines: [{ quantity: 1, unitPrice: 500, receipts: [] }] })];
  const v = purchasingVerdict(waiting);
  ok("an unapproved order leads the sentence", /waiting for approval/.test(v), v);
  ok("  and says what it blocks", /Nothing can be received/.test(v));
  ok("  reading as one when there is one", /^1 order is/.test(v), v);
}
{
  const late = [order({ status: "Approved", total: 1000, expectedDate: "2026-09-01", lines: [{ quantity: 100, unitPrice: 10, receipts: [] }] })];
  const v = purchasingVerdict(late, new Date("2026-09-14T00:00:00.000Z"));
  ok("an overdue order is named next", /past the date the supplier promised/.test(v), v);
}
{
  const open = [order({ status: "Approved", total: 1000, lines: [{ quantity: 100, unitPrice: 10, receipts: rcpt(40) }] })];
  ok("otherwise it says what is on order",
    /600\.00 of material is on order/.test(purchasingVerdict(open)), purchasingVerdict(open));
}
{
  const settled = [order({ status: "Received", total: 100, lines: [{ quantity: 10, unitPrice: 10, receipts: rcpt(10) }] })];
  ok("a settled register says nothing is outstanding",
    /Nothing is on order/.test(purchasingVerdict(settled)), purchasingVerdict(settled));
  // "All 1 order ... are settled" is the kind of thing a reader notices.
  ok("  and one order reads as one",
    /The one order on the register is settled/.test(purchasingVerdict(settled)), purchasingVerdict(settled));
  ok("  while two read as two",
    /All 2 orders on the register are settled/.test(purchasingVerdict([settled[0], settled[0]])));
}

/* ==================================================== how it is written == */

const src = read("src/lib/purchasing.ts");
ok("progress is derived, not stored",
  /summed from the receipts/.test(src) && !/receivedQuantity\s+Float/.test(src));
ok("the three documents are explained, with why each exists",
  /Material request/.test(src) && /Purchase order/.test(src) && /Goods receipt/.test(src));

/* ============================== boundaries, found by mutation testing == */

{
  const p = lineProgress(100, [{ quantity: 100 }]);
  ok("receiving exactly what was ordered is not over-received", p.over === false,
    "the ordinary complete delivery, and the one an off-by-one would flag");
  ok("  and leaves nothing outstanding", p.outstanding === 0);
  ok("  at exactly the whole share", p.share === 1, String(p.share));
}

ok("receiving one more than ordered IS over-received",
  lineProgress(100, [{ quantity: 101 }]).over === true);

{
  const p = lineProgress(0, []);
  ok("a line ordering nothing has a share of nought, not NaN",
    p.share === 0 && !Number.isNaN(p.share), String(p.share));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
