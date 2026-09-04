/**
 * Period and opening-balance arithmetic.
 *
 * These two features decide what every finance report shows, so the rules are
 * exercised directly rather than trusted: a P&L that quietly includes last
 * year's opening balance, or a Balance Sheet that stops balancing when you
 * narrow the dates, is the kind of bug an accountant finds before you do.
 *
 * The library modules are TypeScript, so the test re-runs itself with Node's
 * type stripping and imports the real shipped code — no parallel copy to drift.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)],
    { stdio: "inherit" }
  );
  process.exit(r.status ?? 1);
}

const period = await import("../src/lib/period.ts");
const ledger = await import("../src/lib/ledger.ts");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");
const day = (d) => d.toISOString().slice(0, 10);

/* ------------------------------------------------- financial year -------- */
const janFy = period.financialYear(1, D("2026-09-04"));
ok("Jan-start FY runs Jan–Dec", day(janFy.from) === "2026-01-01" && day(janFy.to) === "2026-12-31");

const aprFeb = period.financialYear(4, D("2026-02-15"));
ok("Apr-start FY: February belongs to the year before", day(aprFeb.from) === "2025-04-01" && day(aprFeb.to) === "2026-03-31",
  `${day(aprFeb.from)} .. ${day(aprFeb.to)}`);

ok("Apr-start FY: May belongs to the current year", day(period.financialYear(4, D("2026-05-15")).from) === "2026-04-01");

/* ------------------------------------------------------- resolve --------- */
const def = period.resolvePeriod({}, 1, D("2026-09-04"));
ok("no dates falls back to the current financial year", def.fromStr === "2026-01-01" && def.toStr === "2026-12-31" && def.isCurrentFy);

const explicit = period.resolvePeriod({ from: "2026-03-01", to: "2026-03-31" }, 1, D("2026-09-04"));
ok("explicit dates are honoured", explicit.fromStr === "2026-03-01" && explicit.toStr === "2026-03-31" && !explicit.isCurrentFy);

const reversed = period.resolvePeriod({ from: "2026-06-30", to: "2026-01-01" }, 1, D("2026-09-04"));
ok("a reversed range is swapped, not left empty", reversed.fromStr === "2026-01-01" && reversed.toStr === "2026-06-30");

const junk = period.resolvePeriod({ from: "not-a-date", to: "13/45/2026" }, 1, D("2026-09-04"));
ok("malformed dates fall back safely", junk.fromStr === "2026-01-01" && junk.toStr === "2026-12-31");

ok("the end date is inclusive to the last instant",
  period.resolvePeriod({ from: "2026-03-01", to: "2026-03-31" }, 1).to.toISOString().startsWith("2026-03-31T23:59:59"));

const qs = period.quarters(1, D("2026-09-04"));
ok("four quarters across the financial year", qs.length === 4 && qs[0].from === "2026-01-01" && qs[3].to === "2026-12-31",
  qs.map((q) => q.label).join(", "));

const aprQs = period.quarters(4, D("2026-05-15"));
ok("quarters follow a non-January year start", aprQs[0].from === "2026-04-01" && aprQs[3].to === "2027-03-31");

/* --------------------------------------------- opening balances ---------- */
const line = (date, debit, credit) => ({ debit, credit, entry: { date: D(date) } });
// Bank opened at 10,000 Dr; received 5,000 in March; paid 2,000 in July.
const bank = { openingBalance: 10000, lines: [line("2026-03-10", 5000, 0), line("2026-07-05", 0, 2000)] };
const asOf = D("2026-01-01");

ok("balance at year end = opening + all movement", ledger.balanceAsAt(bank, D("2026-12-31"), asOf) === 13000);
ok("balance mid-year excludes later movement", ledger.balanceAsAt(bank, D("2026-04-30"), asOf) === 15000);
ok("balance before the books opened is nil", ledger.balanceAsAt(bank, D("2025-12-31"), asOf) === 0);
ok("movement alone ignores the opening balance", ledger.movement(bank, D("2026-04-01"), D("2026-12-31")) === -2000);
ok("brought forward is the balance the day before", ledger.broughtForward(bank, D("2026-04-01"), asOf) === 15000);

// The rule that keeps the P&L honest.
const sales = { openingBalance: -50000, lines: [line("2026-05-01", 0, 20000)] };
ok("opening lands in the period containing the migration date",
  ledger.periodMovement(sales, D("2026-01-01"), D("2026-12-31"), asOf) === -70000);
ok("opening does NOT land in a later period",
  ledger.periodMovement(sales, D("2026-04-01"), D("2026-12-31"), asOf) === -20000);
ok("with no migration date, opening never reaches the P&L",
  ledger.periodMovement(sales, D("2026-01-01"), D("2026-12-31"), null) === -20000);
ok("with no migration date, opening still sits on the Balance Sheet",
  ledger.balanceAsAt(sales, D("2026-12-31"), null) === -70000);

/* ------------------------------------ the books still balance ------------ */
// A migrated trial balance: assets 100k Dr against liabilities 40k and capital 60k Cr.
const opened = [
  { openingBalance: 100000, lines: [] },
  { openingBalance: -40000, lines: [] },
  { openingBalance: -60000, lines: [] },
];
const net = opened.reduce((s, a) => s + ledger.balanceAsAt(a, D("2026-12-31"), asOf), 0);
ok("a migrated opening trial balance nets to zero", Math.abs(net) < 0.001, String(net));

// And it still balances when the reporting period is narrowed.
const narrow = opened.reduce((s, a) => s + ledger.balanceAsAt(a, D("2026-06-30"), asOf), 0);
ok("it still balances when the period is narrowed", Math.abs(narrow) < 0.001, String(narrow));

/* --------------------------------------------------------- wiring -------- */
const read = (p) => fs.readFileSync(p, "utf8");
const screens = ["reports", "daybook", "ledgers", "vat"];
const missing = screens.filter((f) => !read(`src/app/(app)/finance/${f}/page.tsx`).includes("PeriodPicker"));
ok("every finance report has a period picker", missing.length === 0, missing.join(", ") || screens.join(", "));

ok("trial balance is an 'as at' figure including opening",
  read("src/app/(app)/finance/page.tsx").includes("balanceAsAt(a, period.to, openingAsOf)"));

const reports = read("src/app/(app)/finance/reports/page.tsx");
ok("P&L uses period movement, Balance Sheet uses cumulative", reports.includes("periodMovement(") && reports.includes("balanceAsAt("));
ok("retained earnings are cumulative, so the sheet keeps balancing", reports.includes("cumulativeIncome") && reports.includes("retained"));

const form = read("src/components/AccountForm.tsx");
ok("opening balance is captured on the account form", form.includes("openingAmount") && form.includes("openingSide"));
ok("Dr/Cr is stored signed", read("src/app/(app)/finance/actions.ts").includes('side === "Cr" ? -amount : amount'));
ok("financial year and migration date are on the company",
  read("src/components/CompanyForm.tsx").includes("fyStartMonth") && read("src/components/CompanyForm.tsx").includes("openingAsOf"));
ok("the day book is limited to the period", read("src/app/(app)/finance/daybook/page.tsx").includes("date: { gte: period.from, lte: period.to }"));
ok("the ledger shows balance brought forward", read("src/app/(app)/finance/ledgers/page.tsx").includes("broughtForwardBal"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
