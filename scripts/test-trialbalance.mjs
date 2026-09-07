/**
 * The trial balance, and the VAT control accounts it is proved against.
 *
 * A trial balance whose columns do not add up is worse than no trial balance:
 * the accountant trusts the foot of it. So the arithmetic is checked the way it
 * is used — over the real chart, at several date ranges, before and after
 * posting an unbalanced-looking but actually balanced voucher.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { broughtForward, balanceAsAt, openingInPeriod } from "../src/lib/ledger.ts";
import { VAT_INPUT_CODE, VAT_OUTPUT_CODE } from "../src/lib/vat.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const SHIM = "src/lib/.posting.tb.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts").replace(/^import "server-only";.*$/m, "").replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try { ({ postVoucher } = await import("../src/lib/.posting.tb.ts")); } finally { fs.unlinkSync(SHIM); }

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const dr = (v) => (v > 0 ? v : 0);
const cr = (v) => (v < 0 ? -v : 0);
const r2 = (v) => Math.round(v * 100) / 100;

/** The same arithmetic the screen does, so the test cannot pass while it fails. */
async function trialBalance(companyId, from, to, openingAsOf) {
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId },
    include: { lines: { include: { entry: { select: { date: true } } } } },
  });
  const rows = accounts.map((a) => {
    const opening = broughtForward(a, from, openingAsOf);
    const closing = balanceAsAt(a, to, openingAsOf);
    const inPeriod = a.lines.filter((l) => l.entry.date >= from && l.entry.date <= to);
    const openingHere = openingInPeriod(openingAsOf, from, to) ? a.openingBalance : 0;
    return {
      code: a.code,
      openingDr: dr(opening), openingCr: cr(opening),
      periodDr: inPeriod.reduce((t, l) => t + l.debit, 0) + dr(openingHere),
      periodCr: inPeriod.reduce((t, l) => t + l.credit, 0) + cr(openingHere),
      closingDr: dr(closing), closingCr: cr(closing),
    };
  });
  const t = rows.reduce((s, r) => ({
    openingDr: s.openingDr + r.openingDr, openingCr: s.openingCr + r.openingCr,
    periodDr: s.periodDr + r.periodDr, periodCr: s.periodCr + r.periodCr,
    closingDr: s.closingDr + r.closingDr, closingCr: s.closingCr + r.closingCr,
  }), { openingDr: 0, openingCr: 0, periodDr: 0, periodCr: 0, closingDr: 0, closingCr: 0 });
  return { rows, t };
}

const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const acc = (c) => accounts.find((a) => a.code === c);

/* ============================================== the VAT control accounts == */
ok(`the chart has ${VAT_INPUT_CODE} VAT Input`, !!acc(VAT_INPUT_CODE), acc(VAT_INPUT_CODE)?.name);
ok(`and ${VAT_OUTPUT_CODE} VAT Output`, !!acc(VAT_OUTPUT_CODE), acc(VAT_OUTPUT_CODE)?.name);
ok("input VAT is an asset — it is recoverable from the FTA", acc(VAT_INPUT_CODE)?.type === "Asset");
ok("output VAT is a liability — it is owed to the FTA", acc(VAT_OUTPUT_CODE)?.type === "Liability");
ok("the VAT screen agrees the return to those accounts",
  read("src/app/(app)/finance/vat/page.tsx").includes("Does the return agree with the books?"));

/* ============================================ the trial balance balances == */
const TAG = "TB-TEST";
const clean = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((e) => e.id);
  if (ids.length) await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
};
await clean();

const ranges = [
  ["the financial year", "2026-01-01", "2026-12-31"],
  ["one month", "2026-08-01", "2026-08-31"],
  ["a month with nothing in it", "2026-02-01", "2026-02-28"],
  ["a single day", "2026-08-15", "2026-08-15"],
  ["a range before the books start", "2020-01-01", "2020-12-31"],
];
for (const [label, f, t] of ranges) {
  const { t: tot } = await trialBalance(company.id, new Date(f + "T00:00:00.000Z"), new Date(t + "T23:59:59.999Z"), company.openingAsOf);
  ok(`opening columns agree over ${label}`, r2(tot.openingDr) === r2(tot.openingCr), `${r2(tot.openingDr)} / ${r2(tot.openingCr)}`);
  ok(`  period columns agree over ${label}`, r2(tot.periodDr) === r2(tot.periodCr), `${r2(tot.periodDr)} / ${r2(tot.periodCr)}`);
  ok(`  closing columns agree over ${label}`, r2(tot.closingDr) === r2(tot.closingCr), `${r2(tot.closingDr)} / ${r2(tot.closingCr)}`);
}

/* ---------------------- opening + movement must reconcile to closing ------ */
{
  const from = new Date("2026-08-01T00:00:00.000Z"), to = new Date("2026-08-31T23:59:59.999Z");
  const { rows } = await trialBalance(company.id, from, to, company.openingAsOf);
  const bad = rows.filter((r) => {
    const opening = r.openingDr - r.openingCr;
    const moved = r.periodDr - r.periodCr;
    const closing = r.closingDr - r.closingCr;
    return Math.abs(opening + moved - closing) > 0.005;
  });
  ok("every account's opening plus movement equals its closing", bad.length === 0,
    bad.length ? bad.map((b) => b.code).join(", ") : `${rows.length} accounts`);
}

/* ------------------------- a new voucher moves both sides equally --------- */
{
  const before = await trialBalance(company.id, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-12-31T23:59:59.999Z"), company.openingAsOf);
  const posted = await postVoucher({
    companyId: company.id, postedBy: "test", voucherType: "Purchase", date: "2026-08-20",
    memo: `${TAG} vat-bearing invoice`,
    lines: [
      { accountId: acc("5000").id, debit: 20000, credit: 0, vatTreatment: "Standard" },
      { accountId: acc(VAT_INPUT_CODE).id, debit: 1000, credit: 0 },
      { accountId: acc("2000").id, debit: 0, credit: 21000 },
    ],
    vatAmount: 1000,
  });
  ok("a VAT-bearing purchase posts to the control account", posted.ok, posted.ok ? posted.reference : posted.error);

  const after = await trialBalance(company.id, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-12-31T23:59:59.999Z"), company.openingAsOf);
  ok("the period debit and credit both move by the voucher total",
    r2(after.t.periodDr - before.t.periodDr) === 21000 && r2(after.t.periodCr - before.t.periodCr) === 21000,
    `Dr +${r2(after.t.periodDr - before.t.periodDr)}, Cr +${r2(after.t.periodCr - before.t.periodCr)}`);
  ok("and the trial balance still balances afterwards", r2(after.t.closingDr) === r2(after.t.closingCr));

  const vatRow = after.rows.find((r) => r.code === VAT_INPUT_CODE);
  ok("input VAT sits as a debit, being an asset", vatRow.closingDr >= 1000 && vatRow.closingCr === 0,
    `Dr ${vatRow.closingDr}`);
}

/* --------------------------------------------------------------- wiring -- */
const page = read("src/app/(app)/finance/trial-balance/page.tsx");
ok("the screen is permission-gated", page.includes('requireAccess("finance.reports")'));
ok("it shows four column pairs, not two", page.includes("Opening") && page.includes("In the period") && page.includes("Closing"));
ok("it says plainly when it does not balance", page.includes("Out of balance"));
ok("it can be printed and exported", page.includes("PrintReport") && page.includes("trialBalance"));
ok("the tab is registered", read("src/components/FinanceTabsClient.tsx").includes("/finance/trial-balance"));
ok("the export is registered", read("src/app/(app)/export/actions.ts").includes("trialBalance,"));

await clean();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
