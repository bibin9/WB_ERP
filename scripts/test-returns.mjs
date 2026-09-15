/**
 * Material coming back from site (INV-16).
 *
 * The rule the whole thing turns on: reusable material goes back on the shelf
 * and credits the job; scrap does neither. The job keeps the cost because it
 * caused it, and nothing returns to stock because scrap is not stock.
 *
 * Getting that backwards is how a job that wasted six drums of cable reports
 * the same margin as one that wasted none.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { returns } = await importLibs(["returns"]);
const {
  RETURN_CONDITIONS, CONDITION_HELP, RETURN_STATUSES, RETURN_STATUS_HELP,
  goesBackToStock, summariseReturn, checkReturn, returnVerdict,
} = returns;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ================================================== what the words mean == */

ok("both conditions are explained in plain English",
  RETURN_CONDITIONS.every((c) => (CONDITION_HELP[c] || "").length > 40), RETURN_CONDITIONS.join(", "));
ok("and every status too",
  RETURN_STATUSES.every((s) => (RETURN_STATUS_HELP[s] || "").length > 25));

ok("reusable material goes back to stock", goesBackToStock("Reusable") === true);
ok("scrap does not", goesBackToStock("Scrap") === false,
  "putting it back at full value inflates the shelf; at nil value it dilutes the average");

/* ================================================ what a note adds up to = */

const line = (condition, quantity, value) => ({ condition, quantity, value });

{
  const t = summariseReturn([line("Reusable", 100, 1500)]);
  ok("a reusable line credits the job", t.creditedToJob === 1500);
  ok("  and counts towards what returns to the shelf", t.reusableQuantity === 100);
  ok("  with nothing scrapped", t.scrapQuantity === 0 && t.scrapLines === 0);
}

/**
 * The half people expect to behave like the other one, and which does not.
 */
{
  const t = summariseReturn([line("Scrap", 40, 600)]);
  ok("a scrap line credits the job nothing", t.creditedToJob === 0,
    "the job consumed it, so it keeps the cost");
  ok("  even when a value was handed in with it", t.creditedToJob === 0);
  ok("  but the quantity is still recorded", t.scrapQuantity === 40,
    "the store needs to know it is sitting there for disposal");
  ok("  and nothing of it returns to the shelf", t.reusableQuantity === 0);
}

{
  const t = summariseReturn([line("Reusable", 100, 1500), line("Scrap", 40, 600), line("Reusable", 10, 150)]);
  ok("a mixed note separates the two", t.reusableLines === 2 && t.scrapLines === 1);
  ok("  crediting only the reusable half", t.creditedToJob === 1650, String(t.creditedToJob));
  ok("  and counting both quantities", t.reusableQuantity === 110 && t.scrapQuantity === 40);
  ok("  over every line", t.lines === 3);
}

ok("an empty note adds up to nothing", summariseReturn([]).creditedToJob === 0);

/* ============================================= what cannot be returned == */

{
  const r = checkReturn(10, 0, 0, "16mm cable");
  ok("returning something never issued is refused", r.ok === false);
  ok("  naming the item and what to do instead",
    /No 16mm cable was ever issued/.test(r.error) && /adjustment/.test(r.error), r.error);
}
{
  const r = checkReturn(60, 100, 50, "cable");
  ok("returning more than is still out is refused", r.ok === false);
  ok("  saying how much is actually out", /Only 50 of cable is still out/.test(r.error), r.error);
  ok("  and why it matters",
    /credit it with material it never had/.test(r.error),
    "an unchecked return quietly improves a contract's margin for no findable reason");
}
{
  const r = checkReturn(1, 100, 100, "cable");
  ok("returning against a job that sent everything back is refused", r.ok === false);
  ok("  and says so plainly", /already been returned/.test(r.error), r.error);
}

ok("returning exactly what is out is allowed", checkReturn(50, 100, 50, "cable").ok === true);
ok("returning less is allowed", checkReturn(10, 100, 0, "cable").ok === true);
ok("returning nothing is refused", checkReturn(0, 100, 0).ok === false);
ok("returning a negative is refused", checkReturn(-5, 100, 0).ok === false);

/* ======================================================== the sentence == */

ok("an empty note says so", /Nothing on this note yet/.test(returnVerdict([])));

{
  const v = returnVerdict([line("Reusable", 100, 1500)]);
  ok("a reusable note says what the job gets back",
    /going back on the shelf, crediting the job 1,500\.00/.test(v), v);
}
{
  const v = returnVerdict([line("Scrap", 40, 600)]);
  ok("a scrap note says plainly that the job keeps the cost",
    /the job keeps that cost and nothing returns to stock/.test(v), v);
  ok("  because that is the half people expect to work the other way",
    /scrap/.test(v));
}
{
  const v = returnVerdict([line("Reusable", 100, 1500), line("Scrap", 40, 600)]);
  ok("a mixed note says both halves", /crediting the job/.test(v) && /keeps that cost/.test(v), v);
}
{
  const v = returnVerdict([line("Reusable", 1, 10)]);
  ok("one line reads as one", /^1 line going back/.test(v), v);
}

/* ==================================================== how it is written = */

const src = read("src/lib/returns.ts");
ok("the file says why scrap does not go back to stock",
  /inflate the shelf/.test(src) && /dilute the average/.test(src));
ok("and what it costs to get it wrong",
  /the same margin as one that wasted none/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
