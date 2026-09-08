/**
 * UAE Corporate Tax.
 *
 * Every figure below was worked out by hand from Federal Decree-Law 47 of 2022
 * and the FTA's guidance, then checked against the code — not read off the code
 * and written down. A tax computation that agrees with itself proves nothing.
 *
 * The four mistakes this guards against, all of which are easy to make and
 * expensive to file:
 *
 *   - treating AED 375,000 as a cliff rather than a band, which on a small
 *     profit overstates the tax roughly fifteen-fold;
 *   - relieving losses before the adjustments, or after the band;
 *   - relieving more than 75% of taxable income in one period;
 *   - measuring Small Business Relief against profit instead of revenue.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
// Node's type stripping needs the extension on a relative import, and the
// module under test imports the ledger helpers. Same shim the other suites use.
const SHIM = "src/lib/.corporatetax.test.ts";
fs.writeFileSync(
  SHIM,
  fs.readFileSync("src/lib/corporatetax.ts", "utf8").replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let CT;
try { CT = await import("../src/lib/.corporatetax.test.ts"); } finally { fs.unlinkSync(SHIM); }
const {
  CT_RATE, CT_BAND, SBR_REVENUE_CAP, SBR_AVAILABLE_UNTIL, LOSS_RELIEF_CAP,
  FILING_MONTHS, LATE_PENALTY_FIRST_YEAR, LATE_PENALTY_THEREAFTER,
  CT_STATUSES, ADJUSTMENT_KINDS, ADJUSTMENT_CATEGORIES, CATEGORY_KEYS,
  categoryHelp, categoryKind, compute, profitFrom, sbrEligibility, dueDate, filingState,
  financialYear,
} = CT;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(`${s}T00:00:00.000Z`);

/* ============================================== the rates and thresholds == */
ok("the rate is nine per cent", CT_RATE === 0.09);
ok("the nil band is AED 375,000", CT_BAND === 375_000);
ok("Small Business Relief stops at AED 3,000,000 of revenue", SBR_REVENUE_CAP === 3_000_000);
ok("losses relieve at most 75% of taxable income", LOSS_RELIEF_CAP === 0.75);
ok("the return is due nine months after the period", FILING_MONTHS === 9);
ok("the late penalty is 500 then 1,000 a month",
  LATE_PENALTY_FIRST_YEAR === 500 && LATE_PENALTY_THEREAFTER === 1_000);
ok("Small Business Relief runs to 31 December 2029", iso(SBR_AVAILABLE_UNTIL) === "2029-12-31",
  iso(SBR_AVAILABLE_UNTIL));

/* ================================================== the band, not a cliff = */
{
  // AED 1,000,000 profit: 375,000 at nil, 625,000 at 9% = 56,250.
  const c = compute({ accountingProfit: 1_000_000, revenue: 4_000_000, adjustments: [] });
  ok("a million of profit bears AED 56,250", c.taxPayable === 56_250, `got ${c.taxPayable}`);
  ok("the band is shown as used in full", c.bandUsed === 375_000);
  ok("only the excess is chargeable", c.chargeable === 625_000);
}
{
  const c = compute({ accountingProfit: 375_000, revenue: 5_000_000, adjustments: [] });
  ok("profit exactly at the band bears no tax", c.taxPayable === 0, `got ${c.taxPayable}`);
}
{
  // The whole point of a band: one dirham over costs nine fils, not 33,750.
  const c = compute({ accountingProfit: 375_001, revenue: 5_000_000, adjustments: [] });
  ok("one dirham over the band costs nine fils", c.taxPayable === 0.09, `got ${c.taxPayable}`);
}
{
  // 400,000: chargeable 25,000 × 9% = 2,250. Taxing the whole amount would give
  // 36,000 — the error this test exists for.
  const c = compute({ accountingProfit: 400_000, revenue: 5_000_000, adjustments: [] });
  ok("AED 400,000 of profit bears AED 2,250, not AED 36,000",
    c.taxPayable === 2_250, `got ${c.taxPayable}`);
}
{
  const c = compute({ accountingProfit: -150_000, revenue: 900_000, adjustments: [] });
  ok("a loss bears no tax", c.taxPayable === 0);
  ok("and no band is consumed", c.bandUsed === 0);
}

/* ====================================================== the adjustments === */
{
  // 500,000 profit, 3,000 of fines and 10,000 of entertainment added back,
  // 100,000 of UAE dividend taken out: 413,000. Chargeable 38,000 → 3,420.
  const c = compute({
    accountingProfit: 500_000,
    revenue: 4_200_000,
    adjustments: [
      { kind: "Add back", amount: 3_000 },
      { kind: "Add back", amount: 10_000 },
      { kind: "Exempt income", amount: 100_000 },
    ],
  });
  ok("add-backs are totalled", c.addBacks === 13_000, `got ${c.addBacks}`);
  ok("exempt income is totalled apart from deductions",
    c.exemptIncome === 100_000 && c.deductions === 0);
  ok("adjusted profit is 413,000", c.adjustedProfit === 413_000, `got ${c.adjustedProfit}`);
  ok("the tax on it is AED 3,420", c.taxPayable === 3_420, `got ${c.taxPayable}`);
}
{
  const c = compute({
    accountingProfit: 600_000,
    revenue: 4_000_000,
    adjustments: [{ kind: "Deduct", amount: 50_000 }],
  });
  ok("a deduction reduces taxable income", c.adjustedProfit === 550_000);
  ok("and the tax with it", c.taxPayable === 15_750, `got ${c.taxPayable}`);
}
{
  const c = compute({
    accountingProfit: 100_000,
    revenue: 4_000_000,
    adjustments: [{ kind: "Nonsense", amount: 999_999 }],
  });
  ok("an unknown kind is ignored rather than guessed at", c.adjustedProfit === 100_000);
}
{
  const c = compute({
    accountingProfit: 100_000.005,
    revenue: 1_000_000,
    adjustments: [{ kind: "Add back", amount: 0.014 }],
  });
  ok("everything lands on whole fils",
    Math.abs(c.adjustedProfit * 100 - Math.round(c.adjustedProfit * 100)) < 1e-9,
    `${c.adjustedProfit}`);
}

/* ========================================================= loss relief ==== */
{
  // 1,000,000 adjusted, 900,000 of losses. Cap is 750,000, so 750,000 is
  // relieved, 250,000 remains taxable — under the band, so no tax — and
  // 150,000 of loss carries on.
  const c = compute({
    accountingProfit: 1_000_000, revenue: 6_000_000, adjustments: [],
    lossesBroughtForward: 900_000,
  });
  ok("loss relief is capped at 75%", c.lossRelief === 750_000, `got ${c.lossRelief}`);
  ok("the cap is shown", c.lossReliefCap === 750_000);
  ok("taxable income is what is left", c.taxableIncome === 250_000);
  ok("which falls inside the band, so no tax", c.taxPayable === 0);
  ok("the unrelieved loss carries forward", c.lossesCarriedForward === 150_000,
    `got ${c.lossesCarriedForward}`);
}
{
  // Losses smaller than the cap relieve in full.
  const c = compute({
    accountingProfit: 1_000_000, revenue: 6_000_000, adjustments: [],
    lossesBroughtForward: 400_000,
  });
  ok("a loss under the cap relieves in full", c.lossRelief === 400_000);
  ok("600,000 remains taxable", c.taxableIncome === 600_000);
  ok("bearing AED 20,250", c.taxPayable === 20_250, `got ${c.taxPayable}`);
  ok("and nothing carries forward", c.lossesCarriedForward === 0);
}
{
  // A loss made this period joins the pool rather than relieving anything.
  const c = compute({
    accountingProfit: -200_000, revenue: 800_000, adjustments: [],
    lossesBroughtForward: 50_000,
  });
  ok("no relief is taken against a loss", c.lossRelief === 0);
  ok("this period's loss joins the pool", c.lossesCarriedForward === 250_000,
    `got ${c.lossesCarriedForward}`);
}
{
  // Order matters: adjustments, then losses, then the band. Doing losses first
  // against the unadjusted 300,000 would relieve only 225,000 and leave a
  // different answer.
  const c = compute({
    accountingProfit: 300_000, revenue: 6_000_000,
    adjustments: [{ kind: "Add back", amount: 700_000 }],
    lossesBroughtForward: 1_000_000,
  });
  ok("losses are set against the adjusted profit, not the accounting one",
    c.lossRelief === 750_000, `got ${c.lossRelief}`);
  ok("leaving 250,000 taxable and no tax", c.taxableIncome === 250_000 && c.taxPayable === 0);
}
{
  const c = compute({
    accountingProfit: 1_000_000, revenue: 6_000_000, adjustments: [],
    lossesBroughtForward: -5_000,
  });
  ok("a negative brought-forward loss is treated as none", c.lossesBroughtForward === 0);
}

/* ================================================ Small Business Relief === */
{
  const c = compute({
    accountingProfit: 600_000, revenue: 2_500_000, adjustments: [], sbrElected: true,
    periodTo: day("2025-12-31"),
  });
  ok("relief is open at 2.5m of revenue", c.sbrEligible);
  ok("and electing it removes the tax", c.sbrApplied && c.taxPayable === 0);
  ok("the tax it saved is still shown", c.taxWithoutSbr === 20_250, `got ${c.taxWithoutSbr}`);
}
{
  // The threshold is revenue, not profit. A company turning over five million
  // and making three hundred thousand cannot claim.
  const c = compute({
    accountingProfit: 300_000, revenue: 5_000_000, adjustments: [], sbrElected: true,
    periodTo: day("2025-12-31"),
  });
  ok("relief is measured against revenue, not profit", !c.sbrEligible);
  ok("an election that does not qualify is not applied", c.sbrElected && !c.sbrApplied);
}
{
  const at = compute({ accountingProfit: 900_000, revenue: 3_000_000, adjustments: [], sbrElected: true, periodTo: day("2025-12-31") });
  const over = compute({ accountingProfit: 900_000, revenue: 3_000_000.01, adjustments: [], sbrElected: true, periodTo: day("2025-12-31") });
  ok("revenue exactly at the cap still qualifies", at.sbrApplied);
  ok("a fils over it does not", !over.sbrEligible);
}
{
  const last = sbrEligibility(1_000_000, day("2029-12-31"));
  const after = sbrEligibility(1_000_000, day("2030-12-31"));
  ok("a period ending 31 December 2029 may still claim", last.eligible);
  ok("a period ending after it may not", !after.eligible);
  ok("and it says why", /2029/.test(after.reason), after.reason);
}
{
  const c = compute({ accountingProfit: 600_000, revenue: 1_000_000, adjustments: [], sbrElected: false });
  ok("relief that is available but not elected is not applied", c.sbrEligible && !c.sbrApplied);
  ok("so the tax stands", c.taxPayable === 20_250, `got ${c.taxPayable}`);
}

/* ================================================== deadlines and lateness */
ok("a December year-end is due 30 September", iso(dueDate(day("2024-12-31"))) === "2025-09-30",
  iso(dueDate(day("2024-12-31"))));
ok("a 31 May year-end lands on 28 February, not the 31st",
  iso(dueDate(day("2024-05-31"))) === "2025-02-28", iso(dueDate(day("2024-05-31"))));
ok("a 31 May 2027 year-end lands on a leap 29 February",
  iso(dueDate(day("2027-05-31"))) === "2028-02-29", iso(dueDate(day("2027-05-31"))));
ok("a 30 June year-end is due 31 March", iso(dueDate(day("2025-06-30"))) === "2026-03-31",
  iso(dueDate(day("2025-06-30"))));
ok("a 28 February year-end is due 30 November", iso(dueDate(day("2025-02-28"))) === "2025-11-30",
  iso(dueDate(day("2025-02-28"))));
// A period that does not end on a month-end keeps its day rather than being
// pushed to the end of the month — a short first period, or a liquidation.
ok("a mid-month period end keeps its day", iso(dueDate(day("2024-06-15"))) === "2025-03-15",
  iso(dueDate(day("2024-06-15"))));

{
  const st = filingState(day("2024-12-31"), "Draft", day("2025-09-01"));
  ok("a draft inside the deadline is not overdue", !st.overdue);
  ok("and is flagged as due soon", st.dueSoon, `${st.daysRemaining} days`);
  ok("with no penalty", st.estimatedPenalty === 0);
}
{
  const st = filingState(day("2024-12-31"), "Draft", day("2025-10-30"));
  ok("a month past the deadline is overdue", st.overdue);
  ok("and costs AED 500", st.estimatedPenalty === 500, `got ${st.estimatedPenalty}`);
}
{
  // A year and a month late: twelve months at 500, then one at 1,000.
  const st = filingState(day("2024-12-31"), "Draft", day("2026-10-30"));
  ok("thirteen months late costs AED 7,000", st.estimatedPenalty === 7_000,
    `${st.monthsLate} months, ${st.estimatedPenalty}`);
}
{
  // A day late costs the same as a month: the penalty is per month or part.
  const st = filingState(day("2024-12-31"), "Draft", day("2025-10-01"));
  ok("one day late is still one month", st.monthsLate === 1 && st.estimatedPenalty === 500,
    `${st.monthsLate} months, ${st.estimatedPenalty}`);
}
{
  // Exactly twelve months late is the last month at AED 500.
  const st = filingState(day("2024-12-31"), "Draft", day("2026-09-30"));
  ok("twelve months late costs AED 6,000", st.estimatedPenalty === 6_000,
    `${st.monthsLate} months, ${st.estimatedPenalty}`);
}
{
  const st = filingState(day("2024-12-31"), "Filed", day("2027-01-01"));
  ok("a filed return is never overdue", !st.overdue && st.estimatedPenalty === 0);
}

/* =========================================== the period a year gives ====== */
{
  const y = financialYear(1, 2025);
  ok("a January year runs the calendar year",
    iso(y.from) === "2025-01-01" && iso(y.to) === "2025-12-31", `${iso(y.from)}..${iso(y.to)}`);
}
{
  const y = financialYear(7, 2025);
  ok("a July year ends 30 June",
    iso(y.from) === "2024-07-01" && iso(y.to) === "2025-06-30", `${iso(y.from)}..${iso(y.to)}`);
}
{
  const y = financialYear(4, 2025);
  ok("an April year ends 31 March",
    iso(y.from) === "2024-04-01" && iso(y.to) === "2025-03-31", `${iso(y.from)}..${iso(y.to)}`);
}
ok("the tax period is nine months short of its deadline",
  iso(dueDate(financialYear(7, 2025).to)) === "2026-03-31");

/* =============================================== the vocabulary is closed = */
ok("a return is either draft or filed", CT_STATUSES.join(",") === "Draft,Filed");
ok("there are three kinds of adjustment",
  ADJUSTMENT_KINDS.join(",") === "Add back,Deduct,Exempt income");
ok("every category has a kind the computation understands",
  ADJUSTMENT_CATEGORIES.every((c) => ADJUSTMENT_KINDS.includes(c.kind)));
ok("every category explains itself in plain English",
  ADJUSTMENT_CATEGORIES.every((c) => c.help.length > 30 && !/\bs\.\s?\d/.test(c.help)));
ok("the two UAE ones nobody guesses are there",
  CATEGORY_KEYS.includes("Entertainment (50%)") && CATEGORY_KEYS.includes("Fines and penalties"));
ok("help is retrievable by key", categoryHelp("Entertainment (50%)").includes("half"));
ok("an unknown key gives nothing rather than throwing", categoryHelp("nope") === "");
ok("a category suggests its own kind", categoryKind("Dividends from UAE companies") === "Exempt income");

/* ================================================ profit from the ledger == */
{
  const line = (d, dr, cr) => ({ debit: dr, credit: cr, entry: { date: day(d) } });
  const accounts = [
    // Income carries a credit balance.
    { type: "Income", openingBalance: 0, lines: [line("2026-03-01", 0, 250000), line("2025-06-01", 0, 90000)] },
    { type: "Expense", openingBalance: 0, lines: [line("2026-04-01", 170000, 0), line("2025-06-01", 40000, 0)] },
    // A balance-sheet account must not reach the P&L at all.
    { type: "Asset", openingBalance: 500000, lines: [line("2026-05-01", 800000, 0)] },
  ];
  const pl = profitFrom(accounts, day("2026-01-01"), day("2026-12-31"));
  ok("revenue is the income credited in the period", pl.income === 250000, `got ${pl.income}`);
  ok("expenses are the debits in the period", pl.expense === 170000, `got ${pl.expense}`);
  ok("accounting profit is the difference", pl.accountingProfit === 80000, `got ${pl.accountingProfit}`);
  ok("assets and liabilities stay out of the P&L", pl.accountingProfit === 80000);

  const earlier = profitFrom(accounts, day("2025-01-01"), day("2025-12-31"));
  ok("a different period reads only its own vouchers",
    earlier.income === 90000 && earlier.accountingProfit === 50000,
    `${earlier.income} / ${earlier.accountingProfit}`);

  const none = profitFrom(accounts, day("2020-01-01"), day("2020-12-31"));
  ok("a period with no vouchers is nil, not a crash", none.accountingProfit === 0);
}
{
  // Opening balances belong in the P&L only when the books were migrated
  // inside the period — the same rule the reports use.
  const accounts = [{ type: "Income", openingBalance: -100000, lines: [] }];
  const inside = profitFrom(accounts, day("2026-01-01"), day("2026-12-31"), day("2026-06-01"));
  const outside = profitFrom(accounts, day("2026-01-01"), day("2026-12-31"), day("2024-06-01"));
  ok("a migration inside the period brings its opening income in", inside.income === 100000);
  ok("a migration before it does not", outside.income === 0);
}

/* ============================ one reading of the ledger, not three ======== */
{
  // The screen, the export and the carry-forward must agree by construction.
  // Three copies of the same loop is how they stop agreeing.
  const uses = [
    ["the screen", "src/app/(app)/finance/corporate-tax/page.tsx"],
    ["the export", "src/app/(app)/export/actions.ts"],
    ["the carry-forward", "src/app/(app)/finance/corporate-tax/actions.ts"],
  ];
  for (const [what, file] of uses) {
    const src = fs.readFileSync(file, "utf8");
    ok(`${what} reads the profit through the shared helper`, /profitFrom\(/.test(src));
  }
  // The bug this replaced: carrying losses forward from the adjustments alone,
  // with the previous year's profit taken as nil.
  const actions = fs.readFileSync("src/app/(app)/finance/corporate-tax/actions.ts", "utf8");
  ok("the carry-forward no longer assumes last year made nothing",
    !/accountingProfit:\s*0/.test(actions));
}

/* ============================================ against the seeded books ==== */
{
  const companies = await db.company.findMany({ orderBy: { code: "asc" } });
  ok("there are companies to file for", companies.length > 0, `${companies.length}`);

  // The accounting profit the screen will show, read the way the screen reads
  // it: income less expenses over the period, from the ledger itself.
  const co = companies.find((c) => c.code === "WBE") ?? companies[0];
  const from = new Date(Date.UTC(2000, 0, 1));
  const to = new Date(Date.UTC(2100, 0, 1));
  const lines = await db.journalLine.findMany({
    where: { entry: { companyId: co.id, date: { gte: from, lte: to } } },
    include: { account: true },
  });
  let income = 0, expense = 0;
  for (const l of lines) {
    if (l.account.type === "Income") income += l.credit - l.debit;
    else if (l.account.type === "Expense") expense += l.debit - l.credit;
  }
  ok("the seeded books show income", income > 0, `AED ${income.toFixed(2)}`);
  const profit = Math.round((income - expense) * 100) / 100;

  const c = compute({ accountingProfit: profit, revenue: income, adjustments: [] });
  ok("a computation runs off the real ledger", Number.isFinite(c.taxPayable),
    `profit ${profit}, tax ${c.taxPayable}`);
  ok("tax is never negative", c.taxPayable >= 0);
  ok("tax never exceeds nine per cent of taxable income",
    c.taxPayable <= Math.max(0, c.taxableIncome) * CT_RATE + 0.005);

  // Absorption costing nets to nil, so it must not move the tax. If 5100 and
  // 6900 ever stopped cancelling, the corporate tax return would be the last
  // place anyone noticed.
  const labour = lines.filter((l) => ["5100", "6900"].includes(l.account.code));
  if (labour.length) {
    const net = labour.reduce((s, l) => s + l.debit - l.credit, 0);
    ok("labour absorption does not disturb the taxable profit", Math.abs(net) < 0.005,
      `net ${net.toFixed(2)}`);
  }

  // The registration number is separate from the VAT TRN, and the column must
  // exist for the return to quote it.
  ok("a company can hold a corporate tax registration number",
    "corporateTaxTRN" in co, Object.keys(co).includes("corporateTaxTRN") ? "column present" : "missing");

  // Each company is its own taxable person: no return may span two of them.
  const returns = await db.corporateTaxReturn.findMany({ include: { company: true } });
  ok("the return table is reachable", Array.isArray(returns), `${returns.length} row(s)`);
  const crossCo = returns.filter((r) => !companies.some((c) => c.id === r.companyId));
  ok("every return belongs to a real company", crossCo.length === 0);
  const undated = returns.filter((r) => !(r.periodTo > r.periodFrom));
  ok("every period ends after it starts", undated.length === 0);
  // The seed works the financial year out with its own inline arithmetic,
  // because it runs under plain node on the host and cannot import a
  // TypeScript module. Two copies of the same rule is exactly how drift starts,
  // so they are checked against each other here.
  const seeded = await db.corporateTaxReturn.findFirst({
    where: { companyId: co.id },
    include: { adjustments: true },
    orderBy: { periodTo: "desc" },
  });
  ok("the seed opened a tax period", !!seeded);
  if (seeded) {
    const expected = financialYear(co.fyStartMonth ?? 1, seeded.periodTo.getUTCFullYear());
    ok("the seed's financial year matches the one the app computes",
      iso(seeded.periodFrom) === iso(expected.from) && iso(seeded.periodTo) === iso(expected.to),
      `seeded ${iso(seeded.periodFrom)}..${iso(seeded.periodTo)}, computed ${iso(expected.from)}..${iso(expected.to)}`);

    ok("it carries the two adjustments every UAE company meets",
      seeded.adjustments.some((a) => a.category === "Fines and penalties")
      && seeded.adjustments.some((a) => a.category === "Entertainment (50%)"),
      seeded.adjustments.map((a) => a.category).join(", "));

    ok("every seeded adjustment uses a category the form offers",
      seeded.adjustments.every((a) => CATEGORY_KEYS.includes(a.category)));
    ok("and a kind the computation understands",
      seeded.adjustments.every((a) => ADJUSTMENT_KINDS.includes(a.kind)));
    ok("every seeded adjustment is a positive amount",
      seeded.adjustments.every((a) => a.amount > 0));
    ok("the seeded period is not already marked as filed", seeded.status === "Draft");
  }

  // Re-running the seed must not duplicate the period or its adjustments — the
  // deploy runs it on every boot, against a database that already has rows.
  const byPeriod = new Map();
  for (const r of await db.corporateTaxReturn.findMany()) {
    const k = `${r.companyId}|${iso(r.periodFrom)}|${iso(r.periodTo)}`;
    byPeriod.set(k, (byPeriod.get(k) ?? 0) + 1);
  }
  ok("no company has the same period open twice",
    [...byPeriod.values()].every((n) => n === 1),
    `${byPeriod.size} distinct period(s)`);

  const adjKeys = new Map();
  for (const a of await db.corporateTaxAdjustment.findMany()) {
    const k = `${a.returnId}|${a.category}|${a.label}`;
    adjKeys.set(k, (adjKeys.get(k) ?? 0) + 1);
  }
  ok("re-seeding did not duplicate any adjustment",
    [...adjKeys.values()].every((n) => n === 1), `${adjKeys.size} distinct`);
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
