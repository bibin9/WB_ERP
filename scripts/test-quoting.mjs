/**
 * The quotation, from the estimate to the customer's order (CRM-13 to 17).
 *
 * Three rules:
 *   - nobody sees a price management has not approved;
 *   - an issued quotation is revised, never edited, because the customer is
 *     holding a piece of paper;
 *   - the contract value is what the customer ORDERED, not what was quoted,
 *     and a difference has to be acknowledged rather than absorbed.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { quoting: lib } = await importLibs(["quoting"]);
const {
  QUOTE_STATUSES, QUOTE_STATUS_HELP, OUT_WITH_CUSTOMER, CLOSED_QUOTES,
  checkIssue, checkEdit, poVariance, checkAccept, summariseQuotes, quotesVerdict,
} = lib;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const prose = (p) => fs.readFileSync(p, "utf8").replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

const quote = (status, total = 100000) => ({ status, total });

/* ================================================== what the words mean == */

ok("every status is explained in plain English",
  QUOTE_STATUSES.every((s) => (QUOTE_STATUS_HELP[s] || "").length > 25), QUOTE_STATUSES.join(", "));
ok("the customer has seen the issued ones", OUT_WITH_CUSTOMER.has("Issued"));
ok("  and the decided ones", OUT_WITH_CUSTOMER.has("Accepted") && OUT_WITH_CUSTOMER.has("Declined"));
ok("  but not a draft", OUT_WITH_CUSTOMER.has("Draft") === false);
ok("accepted, declined and superseded are all finished with",
  CLOSED_QUOTES.has("Accepted") && CLOSED_QUOTES.has("Declined") && CLOSED_QUOTES.has("Superseded"));

/* ======================== nobody sees a price management has not approved */

ok("an approved quotation can be issued", checkIssue(quote("Approved")).ok === true);

{
  const r = checkIssue(quote("Draft"));
  ok("a draft cannot be issued", r.ok === false);
  ok("  and says to get it approved", /Send it for approval first/.test(r.error), r.error);
  ok("  and why", /Nothing goes to a customer unapproved/.test(r.error), r.error);
}

{
  const r = checkIssue(quote("Awaiting approval"));
  ok("one still with management cannot be issued", r.ok === false);
  ok("  and says so plainly", /has not signed this yet/.test(r.error), r.error);
}

{
  const r = checkIssue(quote("Issued"));
  ok("one already sent cannot be sent again", r.ok === false);
  ok("  and points at a revision", /Raise a revision/.test(r.error), r.error);
}

ok("a superseded quotation cannot be issued", checkIssue(quote("Superseded")).ok === false);

/* ================================= an issued quotation is not edited ==== */

ok("a draft can be edited", checkEdit(quote("Draft")).ok === true);

{
  const r = checkEdit(quote("Awaiting approval"));
  ok("one with management cannot be edited under them", r.ok === false);
  ok("  and says to pull it back", /Pull it back before changing it/.test(r.error), r.error);
}

{
  const r = checkEdit(quote("Issued"));
  ok("an issued quotation cannot be edited", r.ok === false);
  ok("  because the customer is holding it", /customer is holding this quotation/.test(r.error), r.error);
  ok("  and says what the alternative costs",
    /two people reading different documents is worse than no system at all/.test(r.error), r.error);
}

ok("an accepted quotation cannot be edited", checkEdit(quote("Accepted")).ok === false);
ok("a superseded one points at its replacement",
  /Edit the one that replaced it/.test(checkEdit(quote("Superseded")).error));

/* ============ the rule that decides whether a contract reports correctly = */

{
  const v = poVariance(100000, 100000);
  ok("an order for the quoted figure matches", v.matches === true);
  ok("  with no difference", v.difference === 0 && v.direction === "same");
}

{
  const v = poVariance(100000, 92000);
  ok("an order below the quote is a difference", v.matches === false);
  ok("  of the right size", v.difference === -8000, String(v.difference));
  ok("  and share", v.fraction === -0.08, String(v.fraction));
  ok("  in the right direction", v.direction === "less");
}

{
  const v = poVariance(100000, 105000);
  ok("an order above the quote is one too", v.difference === 5000 && v.direction === "more");
}

ok("a variance against nothing quoted does not divide by zero",
  poVariance(0, 5000).fraction === 0 && Number.isFinite(poVariance(0, 5000).fraction));

ok("an order matching the quote is accepted without ceremony",
  checkAccept(quote("Issued", 100000), 100000).ok === true);

{
  const r = checkAccept(quote("Issued", 100000), 92000);
  ok("an order for a different figure is refused until acknowledged", r.ok === false);
  ok("  saying what they ordered and what was quoted",
    /order is for 92,000\.00/.test(r.error) && /100,000\.00 quoted/.test(r.error), r.error);
  ok("  by how much and which way", /8,000\.00 less/.test(r.error), r.error);
  ok("  as a percentage", /\(8\.0%\)/.test(r.error), r.error);
  ok("  and what turns on it",
    /the job will be created at their figure, not ours/.test(r.error),
    "taking the quoted figure makes every margin report wrong from the first day");
}

ok("acknowledged, the difference is accepted",
  checkAccept(quote("Issued", 100000), 92000, true).ok === true,
  "customers round, trim scope and agree discounts on the phone; it is a fact, not an error");

{
  const r = checkAccept(quote("Draft", 100000), 100000);
  ok("an order against an unissued quotation is refused", r.ok === false);
  ok("  and says why", /nothing for them to have ordered/.test(r.error), r.error);
}

ok("an order against an already-accepted quotation is refused",
  checkAccept(quote("Accepted", 100000), 100000).ok === false);
ok("  and against a declined one", checkAccept(quote("Declined", 100000), 100000).ok === false);
ok("an order for nothing is refused", checkAccept(quote("Issued", 100000), 0).ok === false);

/* ========================================================= the numbers == */

{
  const t = summariseQuotes([
    { status: "Issued", total: 100000 },
    { status: "Awaiting approval", total: 50000 },
    { status: "Accepted", total: 200000, orderedValue: 180000 },
    { status: "Declined", total: 120000 },
    { status: "Superseded", total: 999999 },
  ]);
  ok("outstanding counts what is still in play", t.outstanding === 2, String(t.outstanding));
  ok("  at their quoted value", t.outstandingValue === 150000, String(t.outstandingValue));

  /**
   * The rule again, in the reporting.
   */
  ok("an accepted quotation counts what was ORDERED", t.acceptedValue === 180000,
    `${t.acceptedValue} — not the 200,000 quoted`);
  ok("  which is not what was quoted", t.acceptedValue !== 200000);

  ok("declined is counted separately", t.declined === 1 && t.declinedValue === 120000);
  ok("superseded is counted nowhere", t.outstanding === 2 && t.accepted === 1 && t.declined === 1,
    "a replaced quotation is not a live one, a win, or a loss");

  ok("the hit rate is by value", t.hitRate === 0.6, `180000 / 300000, got ${t.hitRate}`);
}

{
  const t = summariseQuotes([{ status: "Accepted", total: 100000 }]);
  ok("an accepted quotation with no order value falls back to the quote",
    t.acceptedValue === 100000, String(t.acceptedValue));
}

ok("no quotations is nothing, not NaN",
  summariseQuotes([]).hitRate === 0 && summariseQuotes([]).outstandingValue === 0);

/* ======================================================== the sentence == */

ok("no quotations says so", /No quotations yet/.test(quotesVerdict(summariseQuotes([]))));

{
  const v = quotesVerdict(summariseQuotes([{ status: "Issued", total: 100000 }]));
  ok("one out reads as one", /^1 quotation out, worth 100,000\.00\./.test(v), v);
}

{
  const v = quotesVerdict(summariseQuotes([
    { status: "Accepted", total: 100000, orderedValue: 100000 },
    { status: "Declined", total: 100000 },
  ]));
  ok("a hit rate over two decided is not quoted", !/% of the value/.test(v), v);
  ok("  and says why", /too few to call a hit rate/.test(v), v);
}

{
  const v = quotesVerdict(summariseQuotes([
    { status: "Accepted", total: 100000, orderedValue: 100000 },
    { status: "Accepted", total: 100000, orderedValue: 100000 },
    { status: "Declined", total: 200000 },
  ]));
  ok("a hit rate over three decided is", /50% of the value decided so far was won/.test(v), v);
  ok("  and says nothing is out", /Nothing out with a customer/.test(v), v);
}

/* ============================== boundaries, found by mutation testing == */

/**
 * Acknowledging a difference must not acknowledge away the order itself.
 */
ok("an order for nothing is refused even when acknowledged",
  checkAccept(quote("Issued", 100000), 0, true).ok === false,
  "a tick that says 'yes I meant that' cannot mean a job worth nothing");
ok("  and a negative one too", checkAccept(quote("Issued", 100000), -5000, true).ok === false);

{
  const v = quotesVerdict(summariseQuotes([{ status: "Issued", total: 100000 }]));
  ok("a run with nothing decided says nothing about a hit rate", !/decided/.test(v), v);
}

{
  const v = quotesVerdict(summariseQuotes([
    { status: "Accepted", total: 100000, orderedValue: 100000 },
    { status: "Declined", total: 100000 },
  ]));
  ok("two decided read as two quotations, not as NaN", /2 quotations decided/.test(v), v);
}

{
  const v = quotesVerdict(summariseQuotes([
    { status: "Accepted", total: 100000, orderedValue: 100000 },
  ]));
  ok("one decided reads as one quotation", /1 quotation decided/.test(v), v);
}

{
  const t = summariseQuotes([
    { status: "Issued", total: 100000 }, { status: "Issued", total: 50000 },
  ]);
  ok("two out read as two", /^2 quotations out/.test(quotesVerdict(t)), quotesVerdict(t));
}

/* ==================================================== how it is written = */

const src = prose("src/lib/quoting.ts");
ok("the file says why issuing is gated on approval",
  /finds out what it agreed to when the customer's order arrives/.test(src));
ok("and why an issued quotation is not edited",
  /two people reading different documents/.test(src));
ok("and what taking the quoted figure costs",
  /every margin report on that job is wrong from the first day/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
