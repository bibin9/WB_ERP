/**
 * The lines on a quotation, as the customer checks them.
 *
 * Two things a customer does with a quotation the moment it arrives: multiply
 * each quantity by its rate to see whether it matches the amount, and add the
 * amounts to see whether they match the total. Both must work on every line,
 * because the rate is what every variation is priced at once they order.
 */
import { importLibs } from "./lib-shim.mjs";

const { "quotation-lines": ql } = await importLibs(["quotation-lines"]);
const { priceLines, readSnapshot } = ql;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ================================================ a realistic estimate == */
{
  // Taken from the test data's jetty estimate: quantities that do not divide
  // neatly, and a lump sum, which is where rounding goes wrong.
  const inputs = [
    { ref: "A.1", description: "Cable pulling and termination", unit: "Metre", quantity: 1800, unitCost: 138.82 },
    { ref: "B.2", description: "Cable tray at high level", unit: "Metre", quantity: 950, unitCost: 263.18 },
    { ref: "C.3", description: "Pipe spool fabrication", unit: "Tonne", quantity: 42, unitCost: 6820 },
    { ref: "G.7", description: "Testing, flushing and reinstatement", unit: "Lump sum", quantity: 1, unitCost: 84400 },
  ];
  const direct = inputs.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const sell = 1300000;
  const priced = priceLines(inputs, direct, sell);

  ok("every line multiplies out: quantity × rate = amount",
    priced.lines.every((l) => r2(l.quantity * l.rate) === l.amount),
    priced.lines.map((l) => `${l.quantity}×${l.rate}=${l.amount}`).join(", "));
  ok("every rate is to the fils",
    priced.lines.every((l) => r2(l.rate) === l.rate));
  ok("the amounts add up to the total",
    r2(priced.lines.reduce((s, l) => s + l.amount, 0)) === priced.total, String(priced.total));

  // The honest cost of every line multiplying out: at most half a fils per
  // unit quoted, and reported rather than absorbed somewhere invisible.
  const bound = inputs.reduce((s, l) => s + l.quantity, 0) * 0.005;
  ok("the total differs from the estimate by no more than rounding can explain",
    Math.abs(priced.total - sell) <= bound + 0.01,
    `difference ${priced.roundingDifference}, allowed ${r2(bound)}`);
  ok("  and that difference is reported, not hidden",
    priced.roundingDifference === r2(priced.total - sell));

  // The same factor for every line: overheads and margin spread in proportion
  // to cost, so no line quietly carries the whole profit.
  const factor = sell / direct;
  ok("each rate is its cost carried up by the estimate's own factor",
    priced.lines.every((l, i) => Math.abs(l.rate - inputs[i].unitCost * factor) <= 0.005 + 1e-9),
    `factor ${factor.toFixed(6)}`);

  ok("the order of the lines is kept", priced.lines.map((l) => l.ref).join() === "A.1,B.2,C.3,G.7");
  ok("a lump sum is one of it, at its full amount",
    priced.lines[3].quantity === 1 && priced.lines[3].amount === priced.lines[3].rate);
}

/* =============================================== edges ============== */
{
  const nothing = priceLines([], 0, 0);
  ok("nothing costed prices nothing", nothing.total === 0 && nothing.lines.length === 0);

  const zeroDirect = priceLines([{ description: "x", unit: "Piece", quantity: 3, unitCost: 10 }], 0, 500);
  ok("with no direct cost there is no factor, so no rate is invented", zeroDirect.lines[0].rate === 0);

  const exact = priceLines([{ description: "x", unit: "Piece", quantity: 4, unitCost: 250 }], 1000, 1200);
  ok("where nothing needs rounding, the total is exactly the estimate's price",
    exact.total === 1200 && exact.roundingDifference === 0, `${exact.lines[0].rate} × 4`);
}

/* ============================================ reading a snapshot back == */
{
  const priced = priceLines([{ ref: "1", description: "Scaffold", unit: "Square metre", quantity: 10, unitCost: 12 }], 120, 150);
  const back = readSnapshot(JSON.stringify(priced.lines));
  ok("a snapshot reads back as the lines that were written",
    JSON.stringify(back) === JSON.stringify(priced.lines));
  ok("no snapshot reads as nothing, not as an empty quotation", readSnapshot(null) === null);
  ok("unreadable JSON reads as nothing rather than as invented lines", readSnapshot("{not json") === null);
  ok("JSON that is not a list reads as nothing", readSnapshot('{"a":1}') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
