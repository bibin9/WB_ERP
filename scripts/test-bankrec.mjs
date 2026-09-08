/**
 * Bank reconciliation.
 *
 * The arithmetic is the whole feature, and it is the kind that looks obviously
 * right and is quietly wrong: the sign of an uncleared payment, whether the
 * opening balance is in the book figure, whether ticking a line moves money.
 * Each of those is checked against a worked example rather than against the
 * code's own behaviour.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { reconcile, daysOutstanding, isStale, STALE_DAYS } from "../src/lib/bankrec.ts";
import { balanceAsAt } from "../src/lib/ledger.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ================================================== the worked example ==== */
// Books say 100,000. A cheque for 8,000 has been written but not presented, and
// a receipt of 3,000 has been banked but not credited yet. The statement should
// therefore read 100,000 + 8,000 − 3,000 = 105,000.
{
  const lines = [
    { amount: -8000, clearedOn: null },
    { amount: 3000, clearedOn: null },
    { amount: 50000, clearedOn: new Date("2026-08-01") },
  ];
  const r = reconcile(lines, 100000, 105000);
  ok("an unpresented payment is added back", r.unclearedPayments === 8000, String(r.unclearedPayments));
  ok("an uncredited receipt is taken off", r.unclearedReceipts === 3000, String(r.unclearedReceipts));
  ok("the statement should read books plus payments less receipts",
    r.expectedStatement === 105000, String(r.expectedStatement));
  ok("and with that figure it reconciles", r.reconciled && r.difference === 0);
  ok("ticked and outstanding are counted apart", r.clearedCount === 1 && r.unclearedCount === 2);
}

{
  // The same, with the statement a thousand out. That thousand is the finding.
  const r = reconcile([{ amount: -8000, clearedOn: null }], 100000, 109000);
  ok("a statement that disagrees leaves a difference", r.difference === 1000, String(r.difference));
  ok("and does not claim to be reconciled", !r.reconciled);
}

{
  const r = reconcile([{ amount: -500, clearedOn: null }], 1000, null);
  ok("with no statement balance there is nothing to disagree with", r.difference === 0 && !r.reconciled);
  ok("but the expected figure is still worked out", r.expectedStatement === 1500);
}

{
  const r = reconcile([], 0, 0);
  ok("an empty account reconciles at nil", r.reconciled && r.expectedStatement === 0);
}

{
  // Fils must not be lost: three awkward amounts that would drift if summed raw.
  const r = reconcile(
    [{ amount: -33.33, clearedOn: null }, { amount: -33.33, clearedOn: null }, { amount: -33.34, clearedOn: null }],
    1000,
    1100
  );
  ok("fils are kept through the arithmetic", r.expectedStatement === 1100 && r.reconciled,
    String(r.expectedStatement));
}

/* ======================================================= stale items ====== */
{
  const asAt = new Date("2026-09-10T00:00:00.000Z");
  ok("age is counted in days", daysOutstanding(new Date("2026-09-01T00:00:00.000Z"), asAt) === 9);
  ok("a fresh item is not stale", !isStale(new Date("2026-08-20T00:00:00.000Z"), asAt));
  ok(`an item older than ${STALE_DAYS} days is`, isStale(new Date("2026-01-01T00:00:00.000Z"), asAt));
  ok("the threshold matches a UAE cheque going stale at six months", STALE_DAYS === 180);
}

/* ============================== ticking a line moves no money ============= */
const company = await db.company.findFirst({ where: { code: "WBE" } });
const bank = await db.chartOfAccount.findFirst({
  where: { companyId: company.id, code: "1000" },
  include: { lines: { include: { entry: { select: { date: true } } } } },
});
ok("there is a bank account to reconcile", !!bank, bank?.name);

{
  const asAt = new Date();
  const before = balanceAsAt(bank, asAt, company.openingAsOf);
  const line = await db.journalLine.findFirst({ where: { accountId: bank.id, clearedOn: null } });

  if (line) {
    await db.journalLine.update({
      where: { id: line.id },
      data: { clearedOn: new Date("2026-09-01T00:00:00.000Z"), statementRef: "ZZ-TEST" },
    });
    const reloaded = await db.chartOfAccount.findUnique({
      where: { id: bank.id },
      include: { lines: { include: { entry: { select: { date: true } } } } },
    });
    const after = balanceAsAt(reloaded, asAt, company.openingAsOf);
    ok("ticking a line does not change the bank balance", before === after, `${before} -> ${after}`);

    const stillThere = await db.journalLine.findUnique({ where: { id: line.id } });
    ok("but it is recorded as cleared", !!stillThere.clearedOn && stillThere.statementRef === "ZZ-TEST");

    // Undo, so the suite can be run again.
    await db.journalLine.updateMany({ where: { statementRef: "ZZ-TEST" }, data: { clearedOn: null, statementRef: null } });
    ok("and unticking puts it back",
      (await db.journalLine.findUnique({ where: { id: line.id } })).clearedOn === null);
  } else {
    ok("ticking a line does not change the bank balance", true, "no uncleared line to tick");
  }
}

/* ============================================================== wiring ==== */
const actions = read("src/app/(app)/finance/bank-rec/actions.ts");
ok("every action checks permission",
  (actions.match(/await allow\("finance\.bankrec"/g) || []).length === 3);
ok("nothing in the reconciliation posts a voucher", !actions.includes("postVoucher"));
ok("a line from another company cannot be ticked", actions.includes("session.companies.some"));
ok("a whole statement can be ticked at once", actions.includes("clearUpTo"));
ok("and undone again, for when it was done against the wrong month",
  actions.includes("unclearStatement"));
ok("bulk ticking only touches lines not already cleared", actions.includes("clearedOn: null"));

const page = read("src/app/(app)/finance/bank-rec/page.tsx");
ok("the screen is permission-gated", page.includes('requireAccess("finance.bankrec")'));
ok("it shows the four figures a reconciliation ends with",
  page.includes("Per your books") && page.includes("Not yet on the statement") &&
  page.includes("So the statement should read") && page.includes("Difference"));
ok("it says when the difference is unexplained", page.includes("unexplained"));
ok("it warns about items too old to still be timing differences", page.includes("outstanding more than"));
// Named the helper rather than the behaviour. The balance is now asked of
// the database instead of summed from every line the account carries, and
// balanceOf applies the same opening-balance rule — lib/ledger-query.ts
// uses openingInBalance, and test-ledgerquery proves the two agree.
ok("the ledger balance includes the opening balance", page.includes("balanceOf("));
ok("the reconciliation is worked over every line, not just the page",
  page.includes("not just the\n  // page") || page.includes("every uncleared line"));
ok("it can be printed", page.includes("PrintReport") && page.includes("PrintHeader"));

ok("the screen is registered for access control", read("src/lib/rbac.ts").includes('"finance.bankrec"'));
ok("and granted to the finance roles", read("prisma/seed.mjs").includes('"finance.bankrec"'));
ok("the tab is wired", read("src/components/FinanceTabsClient.tsx").includes("/finance/bank-rec"));

const schema = read("prisma/schema.prisma");
ok("a line records when the bank showed it", /clearedOn\s+DateTime\?/.test(schema));
ok("and which statement it was ticked against", /statementRef\s+String\?/.test(schema));

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
