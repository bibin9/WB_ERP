/**
 * Asking several suppliers, and choosing between them (INV-05/06/09).
 *
 * The two rules the document exists for:
 *   - at least three suppliers are asked before anything is awarded;
 *   - awarding to anybody but the cheapest requires a reason, recorded at the
 *     moment of the decision.
 *
 * Both are audit controls rather than arithmetic, which is exactly why they
 * have to be enforced by the system: they are the two things a buyer under
 * time pressure will skip, and the two things an auditor asks for a year later.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const { rfq } = await importLibs(["rfq"]);
const {
  RFQ_STATUSES, RFQ_STATUS_HELP, MIN_VENDORS,
  quoteTotal, rankQuotes, summariseRfq, checkAward, rfqVerdict,
} = rfq;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");
/**
 * Source with comment markers and line wrapping taken out.
 *
 * A prose assertion that matches one physical line breaks the moment somebody
 * reflows the paragraph, which teaches people to delete the assertion rather
 * than keep the explanation.
 */
const prose = (p) => read(p).replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

/* ================================================== what the words mean == */

ok("every status is explained in plain English",
  RFQ_STATUSES.every((s) => (RFQ_STATUS_HELP[s] || "").length > 25), RFQ_STATUSES.join(", "));
ok("three is the number of suppliers required", MIN_VENDORS === 3);

/* ========================================== what a quotation comes to === */

const quote = (partyId, partyName, unitPrice, extra = {}) => ({
  partyId, partyName,
  lines: [{ quantity: 100, unitPrice }],
  ...extra,
});

ok("a quotation totals its lines", quoteTotal(quote("a", "A", 12)) === 1200);
ok("  and carriage on top", quoteTotal(quote("a", "A", 12, { delivery: 150 })) === 1350,
  "the cheapest unit price is not the cheapest quote once delivery is in");
ok("an empty quotation comes to nothing", quoteTotal({ partyId: "a", lines: [] }) === 0);

/* ==================================================== putting them in order */

{
  const quotes = [
    quote("b", "Beta", 14),
    quote("a", "Alpha", 12),
    quote("c", "Gamma", 13),
  ];
  const ranked = rankQuotes(quotes);
  ok("quotes come back cheapest first", ranked.map((r) => r.partyName).join(",") === "Alpha,Gamma,Beta",
    ranked.map((r) => `${r.partyName} ${r.total}`).join(" | "));
  ok("  numbered from one", ranked[0].rank === 1 && ranked[2].rank === 3);
  ok("  with the cheapest marked", ranked[0].isLowest === true && ranked[1].isLowest === false);
  ok("  and the others told what they cost extra", ranked[1].extraOverLowest === 100, String(ranked[1].extraOverLowest));
  ok("  as a share too", ranked[2].extraFraction === 0.167, String(ranked[2].extraFraction));
}

/**
 * Carriage is what makes this worth doing at all.
 */
{
  const ranked = rankQuotes([
    quote("a", "Alpha", 12, { delivery: 400 }),
    quote("b", "Beta", 13, { delivery: 0 }),
  ]);
  ok("the cheaper unit price can lose on delivery", ranked[0].partyName === "Beta",
    ranked.map((r) => `${r.partyName} ${r.total}`).join(" | "));
}

/**
 * A supplier who was asked and said nothing is part of the story.
 */
{
  const ranked = rankQuotes([
    quote("a", "Alpha", 12),
    quote("b", "Beta", 13),
    { partyId: "c", partyName: "Gamma", lines: [] },
  ]);
  ok("a supplier who never replied still appears", ranked.length === 3);
  ok("  marked as not received", ranked[2].received === false && ranked[2].partyName === "Gamma");
  ok("  and is not ranked", ranked[2].rank === null,
    "ranking silence against a price would make two quotes look like three");
}

/* ====================================================== the trade-offs === */

{
  const ranked = rankQuotes(
    [quote("a", "Alpha", 12, { leadTimeDays: 30 }), quote("b", "Beta", 13, { leadTimeDays: 5 })],
    { asOf: "2026-01-01", neededBy: "2026-01-10" },
  );
  ok("a quote that arrives after site needs it is flagged", ranked[0].late === true,
    "thirty days against a date nine days away");
  ok("  and one that arrives in time is not", ranked[1].late === false);
}

ok("a quote past its validity is flagged",
  rankQuotes([quote("a", "Alpha", 12, { validUntil: "2025-12-31" })], { asOf: "2026-01-01" })[0].expired === true);
ok("  and one still open is not",
  rankQuotes([quote("a", "Alpha", 12, { validUntil: "2026-06-30" })], { asOf: "2026-01-01" })[0].expired === false);

/* ======================================================== the summary === */

{
  const t = summariseRfq([quote("a", "Alpha", 12), quote("b", "Beta", 14), { partyId: "c", lines: [] }]);
  ok("the summary counts who was asked", t.invited === 3);
  ok("  and who answered", t.quoted === 2 && t.awaiting === 1);
  ok("  and whether enough were asked", t.enoughInvited === true);
  ok("  with the spread between cheapest and dearest", t.spread === 200, String(t.spread));
}

ok("two suppliers is not enough", summariseRfq([quote("a", "A", 1), quote("b", "B", 2)]).enoughInvited === false);

/**
 * The way round the rule, if rows were counted instead of suppliers.
 */
{
  const sameThrice = [quote("a", "Alpha", 12), quote("a", "Alpha", 13), quote("a", "Alpha", 14)];
  ok("the same supplier asked three times counts as one",
    summariseRfq(sameThrice).invited === 1,
    "otherwise the three-supplier rule is satisfied by asking one supplier three times");
  const r = checkAward(sameThrice, "a", null);
  ok("  and cannot be awarded", r.ok === false, r.ok ? "" : r.error);
}

/* ===================================== the rule that survives an audit == */

const three = [quote("a", "Alpha", 12), quote("b", "Beta", 13), quote("c", "Gamma", 14)];

{
  const r = checkAward([quote("a", "Alpha", 12), quote("b", "Beta", 13)], "a", null);
  ok("awarding with only two suppliers asked is refused", r.ok === false);
  ok("  and says why three are wanted",
    /at least 3 suppliers/.test(r.error) && /cannot be called competitive/.test(r.error), r.error);
}

ok("awarding to the cheapest needs no reason", checkAward(three, "a", null).ok === true,
  "the lowest bid defends itself");

{
  const r = checkAward(three, "b", null);
  ok("awarding to a dearer supplier without a reason is refused", r.ok === false);
  ok("  naming what it costs extra and against whom",
    /Beta is 100 dearer than Alpha/.test(r.error), r.error);
  ok("  and saying why the note matters",
    /only record of the decision/.test(r.error),
    "captured while the buyer remembers, or it never exists again");
}

ok("awarding to a dearer supplier WITH a reason is allowed",
  checkAward(three, "b", "Alpha cannot deliver before the shutdown").ok === true,
  "the buyer decides; the system only insists the reason exists");
ok("  but whitespace is not a reason", checkAward(three, "b", "   ").ok === false);

{
  const r = checkAward(three, "zzz", "any reason");
  ok("awarding to a supplier who was never asked is refused", r.ok === false);
  ok("  and says so plainly", /was not asked/.test(r.error), r.error);
}

{
  const withSilent = [...three, { partyId: "d", partyName: "Delta", lines: [] }];
  const r = checkAward(withSilent, "d", "we like them");
  ok("awarding to a supplier who never sent a price is refused", r.ok === false);
  ok("  and names them", /Delta has not sent a price/.test(r.error), r.error);
}

/**
 * Three invited, one replied. The rule is about who was ASKED.
 */
{
  const mostlySilent = [quote("a", "Alpha", 12), { partyId: "b", lines: [] }, { partyId: "c", lines: [] }];
  ok("one reply from three invited can still be awarded", checkAward(mostlySilent, "a", null).ok === true,
    "a buyer is not punished for suppliers being slow");
}

/* ======================================================== the sentence == */

ok("an enquiry with nobody asked says so", /No supplier has been asked yet/.test(rfqVerdict([])));

{
  const v = rfqVerdict([quote("a", "Alpha", 12), quote("b", "Beta", 13)]);
  ok("too few suppliers is said first", /^Only 2 suppliers asked\./.test(v), v);
  ok("  and says how many more are wanted", /Ask 1 more before this can be awarded/.test(v), v);
}

{
  const v = rfqVerdict([quote("a", "Alpha", 12), quote("b", "Beta", 14), { partyId: "c", lines: [] }]);
  ok("the sentence gives the range", /from 1,200\.00 to 1,400\.00/.test(v), v);
  ok("  and the spread", /spread is 200\.00/.test(v), v);
  ok("  and who has not replied", /1 supplier has not replied/.test(v), v);
}

{
  const v = rfqVerdict(
    [quote("a", "Alpha", 12, { leadTimeDays: 60 }), quote("b", "Beta", 13), quote("c", "Gamma", 14)],
    "2026-01-05",
  );
  ok("a cheapest quote that arrives too late is called out",
    /cheapest quote arrives after site needs it/.test(v), v);
}

{
  const v = rfqVerdict([
    quote("a", "Alpha", 12, { validUntil: "2000-01-01" }),
    quote("b", "Beta", 13), quote("c", "Gamma", 14),
  ]);
  ok("an expired quote is called out", /has expired and would need confirming/.test(v), v);
}


/* ============================== boundaries, found by mutation testing == */

{
  const r = rankQuotes(
    [quote("a", "Alpha", 12, { leadTimeDays: 9 })],
    { asOf: "2026-01-01", neededBy: "2026-01-10" },
  );
  ok("a lead time landing exactly on the date site needs it is not late", r[0].late === false,
    "nine days from the first is the tenth, which is the day it is wanted");
}

ok("a quotation whose validity runs to today has not expired",
  rankQuotes([quote("a", "Alpha", 12, { validUntil: "2026-01-01" })], { asOf: "2026-01-01" })[0].expired === false,
  "held until the 31st still means the 31st");

{
  const r = rankQuotes([quote("a", "Alpha", 0), quote("b", "Beta", 0)]);
  ok("quotes that all come to nothing do not produce NaN",
    r.every((x) => !Number.isNaN(x.extraFraction) && x.extraFraction === 0),
    r.map((x) => x.extraFraction).join(","));
}

{
  const v = rfqVerdict([quote("a", "Alpha", 12), quote("b", "Beta", 12), quote("c", "Gamma", 12)]);
  ok("three identical quotes report no spread", !/spread/.test(v), v);
  ok("  and nobody outstanding", !/not replied/.test(v), v);
}

/* ==================================================== how it is written = */

const src = prose("src/lib/rfq.ts");
ok("the file says why there is no weighted score",
  /nobody agreed those weights/.test(src) && /people stop arguing with it/.test(src));
ok("and why three suppliers rather than two",
  /single-sourcing with extra steps/.test(src));
ok("and why the reason is captured at the moment of the decision",
  /never exists again/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
