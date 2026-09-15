/**
 * Numbering a document.
 *
 * Small enough to look obvious, which is why it is tested: the one thing it
 * must never do is hand out a number somebody already has, and the way that
 * happened in production was a count standing in for a maximum.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { docnumber } = await importLibs(["docnumber"]);
const { SERIAL_WIDTH, documentStem, nextInSeries } = docnumber;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const on = (iso) => new Date(iso + "T00:00:00.000Z");

/* ========================================================== the stem === */

ok("the stem carries company, document and year",
  documentStem("WBE", "PO", on("2026-04-01")) === "WBE/PO/26/",
  documentStem("WBE", "PO", on("2026-04-01")));
ok("  and the year is the calendar one",
  documentStem("WBE", "PO", on("2027-01-02")) === "WBE/PO/27/",
  "a purchase order is looked for by the year it was raised");
ok("a company with no code still gets a stem",
  documentStem("", "MR", on("2026-04-01")) === "CO/MR/26/",
  "a missing code must not produce a number starting with a slash");

/* ======================================================== the serial === */

ok("the first document in a series is 0001",
  nextInSeries("WBE/PO/26/", null) === "WBE/PO/26/0001");
ok("  and so is the first when nothing parses",
  nextInSeries("WBE/PO/26/", undefined) === "WBE/PO/26/0001");
ok("the next follows the highest issued",
  nextInSeries("WBE/PO/26/", "WBE/PO/26/0007") === "WBE/PO/26/0008");
ok("  padded to a fixed width", SERIAL_WIDTH === 4 && nextInSeries("A/B/26/", "A/B/26/0009").endsWith("0010"));
ok("  and past the padding when it runs out",
  nextInSeries("A/B/26/", "A/B/26/9999") === "A/B/26/10000",
  "a register that stops at ten thousand would stop the company");

/**
 * The failure that cost a company a financial year, in the other register.
 */
{
  // Highest is 0012 even though only three documents exist: 1 to 9 were removed.
  ok("a gap in the series does not reuse a number",
    nextInSeries("WBE/PO/26/", "WBE/PO/26/0012") === "WBE/PO/26/0013",
    "counting the rows would have said 0004, which is free, and then 0013 would never be reached");
}

/**
 * A row somebody wrote by hand must not stop the register.
 */
ok("a number that does not parse is treated as none",
  nextInSeries("WBE/PO/26/", "PO-legacy-import") === "WBE/PO/26/0001");
ok("  including one from a different series",
  nextInSeries("WBE/PO/26/", "WBE/PO/25/0044") === "WBE/PO/26/0001",
  "last year's highest says nothing about this year's next");

/* ==================================================== how it is written = */

const src = prose("src/lib/docnumber.ts");
ok("the file says why the highest is used rather than a count",
  /stopped a company posting for a financial year/.test(src));
ok("and why voucher numbering was left where it is",
  /restarts on the financial year/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
