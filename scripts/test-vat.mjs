/**
 * UAE VAT 201.
 *
 * These figures go on a filed return, so the rules are exercised directly:
 * mixed-treatment invoices, credit notes that reduce what was declared, and
 * reverse charge, which must appear on both sides and net to nil.
 */
import {
  buildVat201, taxOn, VAT_RATE, VAT_TREATMENTS, TREATMENT_HELP,
} from "../src/lib/vat.ts";
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const line = (voucherType, treatment, taxableValue) => ({ voucherType, treatment, taxableValue });

/* ------------------------------------------------------------ the rate --- */
ok("the standard rate is 5%", VAT_RATE === 0.05);
ok("standard-rated work bears tax", taxOn("Standard", 100000) === 5000);
ok("zero-rated work bears none", taxOn("Zero-rated", 100000) === 0);
ok("exempt work bears none", taxOn("Exempt", 100000) === 0);
ok("out-of-scope work bears none", taxOn("Out of scope", 100000) === 0);
ok("reverse charge is computed at the standard rate", taxOn("Reverse charge", 100000) === 5000);
ok("every treatment is explained in plain English",
  VAT_TREATMENTS.every((t) => (TREATMENT_HELP[t] || "").length > 30), VAT_TREATMENTS.join(", "));

/* ------------------------------------------- a mixed contractor invoice -- */
// Mainland work 200,000 standard, an export 80,000 zero-rated, and 20,000 of
// exempt supplies — one invoice, three treatments.
const mixed = buildVat201([
  line("Sales", "Standard", 200000),
  line("Sales", "Zero-rated", 80000),
  line("Sales", "Exempt", 20000),
]);
ok("standard supplies land in box 1 with their tax",
  mixed.standardSupplies.amount === 200000 && mixed.standardSupplies.vat === 10000,
  `${mixed.standardSupplies.amount} / ${mixed.standardSupplies.vat}`);
ok("zero-rated supplies are declared but untaxed (box 4)", mixed.zeroRatedSupplies === 80000);
ok("exempt supplies are declared but untaxed (box 5)", mixed.exemptSupplies === 20000);
ok("only standard-rated work produces output tax", mixed.outputTax === 10000);

/* ------------------------------------------------------- out of scope ---- */
const oos = buildVat201([line("Sales", "Standard", 100000), line("Sales", "Out of scope", 500000)]);
ok("out-of-scope supplies appear in no box at all",
  oos.standardSupplies.amount === 100000 && oos.zeroRatedSupplies === 0 && oos.exemptSupplies === 0 && oos.outputTax === 5000);

/* --------------------------------------------------------- input tax ---- */
const withCosts = buildVat201([
  line("Sales", "Standard", 200000),
  line("Purchase", "Standard", 80000),
  line("Purchase", "Exempt", 30000),
]);
ok("standard-rated expenses give recoverable tax (box 9)",
  withCosts.standardExpenses.amount === 80000 && withCosts.standardExpenses.vat === 4000);
ok("exempt expenses recover nothing", withCosts.inputTax === 4000);
ok("net payable is output less input (box 14)", withCosts.netPayable === 6000, `10,000 − 4,000 = ${withCosts.netPayable}`);

/* ------------------------------------------------------ credit notes ---- */
// A credit note reduces the supply already declared — it must not add to it.
const withNote = buildVat201([
  line("Sales", "Standard", 200000),
  line("Credit Note", "Standard", 40000),
]);
ok("a credit note reduces standard supplies", withNote.standardSupplies.amount === 160000,
  `200,000 − 40,000 = ${withNote.standardSupplies.amount}`);
ok("and reduces the output tax with it", withNote.outputTax === 8000, `${withNote.outputTax}`);

const withDebitNote = buildVat201([
  line("Purchase", "Standard", 100000),
  line("Debit Note", "Standard", 25000),
]);
ok("a debit note reduces expenses and the tax reclaimed",
  withDebitNote.standardExpenses.amount === 75000 && withDebitNote.inputTax === 3750,
  `${withDebitNote.standardExpenses.amount} / ${withDebitNote.inputTax}`);

/* ---------------------------------------------------- reverse charge ---- */
// Imported engineering services: declared as output and reclaimed as input.
const rcm = buildVat201([line("Purchase", "Reverse charge", 100000)]);
ok("reverse charge is declared as a supply (box 3)",
  rcm.reverseChargeSupplies.amount === 100000 && rcm.reverseChargeSupplies.vat === 5000);
ok("and reclaimed as an expense (box 10)",
  rcm.reverseChargeExpenses.amount === 100000 && rcm.reverseChargeExpenses.vat === 5000);
ok("so it nets to nil, which is the whole point", rcm.netPayable === 0,
  `output ${rcm.outputTax} − input ${rcm.inputTax} = ${rcm.netPayable}`);

const rcmMixed = buildVat201([line("Sales", "Standard", 200000), line("Purchase", "Reverse charge", 100000)]);
ok("reverse charge does not disturb the rest of the return", rcmMixed.netPayable === 10000,
  `${rcmMixed.outputTax} − ${rcmMixed.inputTax} = ${rcmMixed.netPayable}`);

/* ------------------------------------------------------ unclassified ---- */
const untagged = buildVat201([line("Sales", null, 50000), line("Sales", "Standard", 100000)]);
ok("a line with no treatment is flagged, not silently dropped", untagged.unclassified === 50000);
ok("and it is kept out of the boxes", untagged.standardSupplies.amount === 100000);

/* ------------------------------------------------- non-VAT vouchers ----- */
const ignored = buildVat201([
  line("Journal", "Standard", 999999),
  line("Contra", "Standard", 999999),
  line("Sales", "Standard", 100000),
]);
ok("journals and contras never reach the return", ignored.standardSupplies.amount === 100000);

/* ------------------------------------------------------------ money ----- */
const rounding = buildVat201([line("Sales", "Standard", 33333.33)]);
ok("tax is rounded to fils", rounding.standardSupplies.vat === 1666.67, String(rounding.standardSupplies.vat));

ok("an empty period returns a nil return",
  buildVat201([]).netPayable === 0 && buildVat201([]).outputTax === 0);

/* ---------------------------------------------------------- wiring ------ */
ok("treatment is stored on the line, not the voucher",
  fs.readFileSync("prisma/schema.prisma", "utf8").includes("vatTreatment String?"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
