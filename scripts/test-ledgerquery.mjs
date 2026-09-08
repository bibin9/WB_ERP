/**
 * The aggregated ledger reads must agree with the loop they replace, exactly.
 *
 * This is a performance change to the code that produces a trial balance, a
 * P&L and a VAT reconciliation. A performance change that alters a figure by a
 * fils is not an optimisation, it is a defect with a stopwatch attached — so
 * the whole point of this file is equivalence, not speed.
 *
 * Both paths are run against the same real data, account by account, and every
 * number is compared: brought forward, gross movement each way, and closing.
 */
import { PrismaClient } from "@prisma/client";
import { importLibs } from "./lib-shim.mjs";

const L = await importLibs(["ledger"]);
const { broughtForward, periodMovement, balanceAsAt, openingInPeriod } = L.ledger;

// The module under test is server-only and reaches for the shared Prisma
// client, which a plain node import cannot resolve — so db.ts comes along in
// the shim set too.
const LQ = await importLibs(["db", "ledger", "ledger-query"]);
const { accountBalances, profitAndLoss, balanceOf, withActivity } = LQ["ledger-query"];

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const day = (s) => new Date(`${s}T00:00:00.000Z`);
const near = (a, b) => Math.abs(a - b) < 0.005;

/** The old way, kept here as the thing the new way has to match. */
async function theOldWay(companyId, from, to, openingAsOf) {
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId },
    include: { lines: { include: { entry: { select: { date: true } } } } },
    orderBy: { code: "asc" },
  });
  return accounts.map((a) => {
    const inPeriod = a.lines.filter((l) => l.entry.date >= from && l.entry.date <= to);
    const openingHere = openingInPeriod(openingAsOf, from, to) ? a.openingBalance : 0;
    return {
      code: a.code,
      brought: broughtForward(a, from, openingAsOf),
      periodDr: inPeriod.reduce((s, l) => s + l.debit, 0) + Math.max(0, openingHere),
      periodCr: inPeriod.reduce((s, l) => s + l.credit, 0) + Math.max(0, -openingHere),
      moved: periodMovement(a, from, to, openingAsOf),
      closing: balanceAsAt(a, to, openingAsOf),
    };
  });
}

const companies = await db.company.findMany({ orderBy: { code: "asc" } });
ok("there are companies to compare", companies.length > 0, `${companies.length}`);

// Several periods, because the interesting cases are the boundaries: a period
// before anything was posted, one that contains the migration date, one after.
const PERIODS = [
  ["a wide window covering everything", "2000-01-01", "2100-01-01"],
  ["the current financial year", "2026-01-01", "2026-12-31"],
  ["a year with nothing in it", "2019-01-01", "2019-12-31"],
  ["a single day", "2026-09-08", "2026-09-08"],
  ["a period ending before the books began", "2001-01-01", "2001-12-31"],
];

for (const co of companies) {
  const company = await db.company.findUnique({ where: { id: co.id } });
  for (const [label, f, t] of PERIODS) {
    const from = day(f), to = day(t);
    const [oldRows, newRows] = await Promise.all([
      theOldWay(co.id, from, to, company?.openingAsOf),
      accountBalances(co.id, from, to, company?.openingAsOf),
    ]);

    ok(`${co.code}: same accounts returned for ${label}`,
      oldRows.length === newRows.length, `${oldRows.length} vs ${newRows.length}`);

    const byCode = new Map(newRows.map((r) => [r.code, r]));
    const wrong = [];
    for (const o of oldRows) {
      const n = byCode.get(o.code);
      if (!n) { wrong.push(`${o.code} missing`); continue; }
      if (!near(o.brought, n.brought)) wrong.push(`${o.code} brought ${o.brought} vs ${n.brought}`);
      if (!near(o.periodDr, n.periodDr)) wrong.push(`${o.code} Dr ${o.periodDr} vs ${n.periodDr}`);
      if (!near(o.periodCr, n.periodCr)) wrong.push(`${o.code} Cr ${o.periodCr} vs ${n.periodCr}`);
      if (!near(o.moved, n.moved)) wrong.push(`${o.code} moved ${o.moved} vs ${n.moved}`);
      if (!near(o.closing, n.closing)) wrong.push(`${o.code} closing ${o.closing} vs ${n.closing}`);
    }
    ok(`${co.code}: every figure identical for ${label}`, wrong.length === 0, wrong.slice(0, 4).join("; "));
  }
}

/* ============================= the invariants the trial balance relies on = */
{
  const co = companies.find((c) => c.code === "WBE") ?? companies[0];
  const company = await db.company.findUnique({ where: { id: co.id } });
  const rows = await accountBalances(co.id, day("2000-01-01"), day("2100-01-01"), company?.openingAsOf);

  const dr = rows.reduce((s, r) => s + r.periodDr, 0);
  const cr = rows.reduce((s, r) => s + r.periodCr, 0);
  ok("the aggregated trial balance still balances", near(dr, cr), `Dr ${dr.toFixed(2)} / Cr ${cr.toFixed(2)}`);

  const adds = rows.every((r) => near(r.brought + r.moved, r.closing));
  ok("brought forward plus movement equals closing, on every line", adds);

  const signs = rows.every((r) => r.periodDr >= 0 && r.periodCr >= 0);
  ok("no gross column is negative", signs);

  const active = withActivity(rows);
  ok("dead accounts can be dropped from a printed report",
    active.length <= rows.length, `${active.length} of ${rows.length} have activity`);
}

/* ================================================== the P&L shortcut ====== */
{
  const co = companies.find((c) => c.code === "WBE") ?? companies[0];
  const company = await db.company.findUnique({ where: { id: co.id } });
  const from = day("2026-01-01"), to = day("2026-12-31");

  const pl = await profitAndLoss(co.id, from, to, company?.openingAsOf);
  const rows = await accountBalances(co.id, from, to, company?.openingAsOf, { types: ["Income", "Expense"] });
  const income = rows.filter((r) => r.type === "Income").reduce((s, r) => s - r.moved, 0);
  const expense = rows.filter((r) => r.type === "Expense").reduce((s, r) => s + r.moved, 0);

  ok("the P&L shortcut agrees with the account rows",
    near(pl.income, income) && near(pl.expense, expense) && near(pl.accountingProfit, income - expense),
    `income ${pl.income}, expense ${pl.expense}, profit ${pl.accountingProfit}`);
  ok("and it only fetched income and expense accounts",
    rows.every((r) => r.type === "Income" || r.type === "Expense"), `${rows.length} accounts`);
}

/* ============================================= one account, for a panel === */
{
  const co = companies.find((c) => c.code === "WBE") ?? companies[0];
  const company = await db.company.findUnique({ where: { id: co.id } });
  const asAt = day("2100-01-01");

  const all = await accountBalances(co.id, day("2000-01-01"), asAt, company?.openingAsOf);
  for (const code of ["1100", "2000", "1160"]) {
    const one = await balanceOf(co.id, code, asAt, company?.openingAsOf);
    const row = all.find((r) => r.code === code);
    if (!row) {
      ok(`${code} is absent and says so`, !one.found);
      continue;
    }
    ok(`${code}: the single-account read matches the full sweep`,
      one.found && near(one.balance, row.closing), `${one.balance} vs ${row.closing}`);
  }
  const nope = await balanceOf(co.id, "ZZZZ", asAt);
  ok("an account that does not exist returns nil rather than throwing",
    !nope.found && nope.balance === 0);
}

/* ============================ an empty company does not fall over ========= */
{
  const empty = companies.find((c) => c.code === "WBM");
  if (empty) {
    const rows = await accountBalances(empty.id, day("2026-01-01"), day("2026-12-31"), null);
    ok("a company with no chart returns nothing rather than erroring", rows.length === 0);
    const pl = await profitAndLoss(empty.id, day("2026-01-01"), day("2026-12-31"), null);
    ok("and its P&L is nil, not NaN", pl.income === 0 && pl.accountingProfit === 0);
  }
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
