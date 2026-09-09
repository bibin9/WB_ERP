/**
 * Finance settings: the customer's own chart, and rates the law can move.
 *
 * The defect this closes was a sales blocker rather than a bug. Every posting
 * named a literal account code — 1160 for retention receivable, 6000 for wages
 * — so a contractor who had run the same ledger for fifteen years could not use
 * the system without renumbering it. A role now points at whatever code they
 * actually use.
 *
 * The proof that matters is at the bottom: a company whose chart uses entirely
 * different numbers posts a real voucher, through the real posting seam, into
 * the accounts it mapped.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const L = await importLibs(["financepolicy"]);
const {
  ACCOUNT_ROLES, DEFAULT_FINANCE_POLICY, STATUTORY_NOTE,
  validateFinancePolicy, withFinanceDefaults, parseAccounts, financeChanges,
} = L.financepolicy;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ================================================ the shipped defaults ==== */
ok("VAT is five per cent", DEFAULT_FINANCE_POLICY.vatRate === 0.05);
ok("corporate tax is nine above the band", DEFAULT_FINANCE_POLICY.corporateTaxRate === 0.09);
ok("the band is AED 375,000", DEFAULT_FINANCE_POLICY.corporateTaxBand === 375_000);
ok("Small Business Relief stops at AED 3,000,000", DEFAULT_FINANCE_POLICY.sbrRevenueCap === 3_000_000);
ok("losses relieve at most 75%", DEFAULT_FINANCE_POLICY.lossReliefCap === 0.75);
ok("the return is due nine months on", DEFAULT_FINANCE_POLICY.filingMonths === 9);
ok("a cheque goes stale at 180 days", DEFAULT_FINANCE_POLICY.chequeStaleDays === 180);
ok("the shipped defaults are themselves valid", validateFinancePolicy(DEFAULT_FINANCE_POLICY).length === 0);
ok("every rate carries a note saying what the law says",
  ["vatRate", "corporateTaxRate", "corporateTaxBand", "lossReliefCap", "filingMonths"]
    .every((k) => (STATUTORY_NOTE[k] ?? "").length > 20));

/* ===================================== every posting is a role, not a code = */
ok("every place the system posts has a role",
  ACCOUNT_ROLES.length >= 11, `${ACCOUNT_ROLES.length} roles`);
ok("each role explains what it is for",
  ACCOUNT_ROLES.every((r) => r.why.length > 25 && r.label.length > 3));
ok("each has a default code to fall back on",
  ACCOUNT_ROLES.every((r) => /^[0-9]{4}$/.test(r.code)));
ok("no two roles default to the same account",
  new Set(ACCOUNT_ROLES.map((r) => r.code)).size === ACCOUNT_ROLES.length);

{
  // The whole point: no module may name a literal account number again.
  const consumers = [
    "src/app/(app)/finance/retention/actions.ts",
    "src/app/(app)/finance/cheques/actions.ts",
    "src/app/(app)/finance/jobs/labour-actions.ts",
    "src/app/(app)/hr/payroll/actions.ts",
  ];
  for (const f of consumers) {
    const src = fs.readFileSync(f, "utf8");
    ok(`${f.split("/").pop()} asks for a role`, /accountsForPosting\(/.test(src));
    const literals = [...src.matchAll(/(?:^|[^\w"])"(\d{4})"/g)].map((m) => m[1]);
    ok(`${f.split("/").pop()} names no account number`, literals.length === 0,
      literals.length ? `still hard-coded: ${[...new Set(literals)].join(", ")}` : "clean");
  }
  for (const f of ["src/app/(app)/finance/vat/page.tsx", "src/app/(app)/finance/retention/page.tsx"]) {
    const src = fs.readFileSync(f, "utf8");
    ok(`${f.split("/").pop()} reads the mapped code`, /financePolicyFor\(/.test(src));
  }
}

/* =============================================== what will not be saved === */
{
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, vatRate: 5 });
  ok("a VAT rate typed as 5 rather than 0.05 is refused", p.length === 1, p[0]?.message);
  ok("and the message says which it wants", /0\.05 for five per cent/.test(p[0].message), p[0].message);
}
{
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, corporateTaxRate: -0.1 });
  ok("a negative tax rate is refused", p.length === 1);
}
{
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, chequeStaleDays: 5 });
  ok("a five-day cheque life is refused", p.length === 1, p[0].message);
}
{
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, defaultRetentionPercent: 80 });
  ok("eighty per cent retention is refused", p.length === 1, p[0].message);
}
{
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, expiryWarningDays: 2, pageSize: 5000 });
  ok("a two-day warning and a 5,000-row page are both refused", p.length === 2);
}
{
  const accounts = { ...DEFAULT_FINANCE_POLICY.accounts, vatInput: "2150" }; // same as vatOutput
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, accounts });
  ok("two roles on one account is refused", p.length === 1, p[0].message);
  ok("because the reconciliations compare them",
    /reconciliations/.test(p[0].message), p[0].message);
}
{
  const accounts = { ...DEFAULT_FINANCE_POLICY.accounts, bank: "" };
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, accounts });
  ok("a role left blank is refused", p.length === 1, p[0].message);
}
{
  const accounts = { ...DEFAULT_FINANCE_POLICY.accounts, bank: "not a code!" };
  const p = validateFinancePolicy({ ...DEFAULT_FINANCE_POLICY, accounts });
  ok("a code that is not a code is refused", p.length === 1, p[0].message);
}
ok("a company using a completely different chart is fine",
  validateFinancePolicy({
    ...DEFAULT_FINANCE_POLICY,
    accounts: Object.fromEntries(ACCOUNT_ROLES.map((r, i) => [r.key, `A${100 + i}`])),
  }).length === 0);

/* ================================================== defaults and merging == */
ok("no record at all gives the shipped defaults", withFinanceDefaults(null).vatRate === 0.05);
ok("a partial record keeps the rest",
  withFinanceDefaults({ vatRate: 0.07 }).corporateTaxRate === 0.09);
ok("a partial account map keeps the other roles",
  withFinanceDefaults({ accounts: { bank: "5000" } }).accounts.salaryExpense === "6000");
ok("and takes the one it was given",
  withFinanceDefaults({ accounts: { bank: "5000" } }).accounts.bank === "5000");
ok("malformed stored JSON does not crash the screen",
  Object.keys(parseAccounts("{not json")).length === 0);
ok("nor does an empty one", Object.keys(parseAccounts(null)).length === 0);
{
  const moved = withFinanceDefaults({ vatRate: 0.07, accounts: { bank: "5000", salaryExpense: "5010" } });
  const changes = financeChanges(moved);
  ok("the screen can say what a company changed", changes.length === 2, changes.join("; "));
  ok("including how many accounts were remapped",
    changes.some((c) => /2 accounts mapped/.test(c)), changes.join("; "));
  ok("and a default company claims nothing",
    financeChanges(DEFAULT_FINANCE_POLICY).length === 0);
}

/* ========== a company with its own chart posts into its own accounts ====== */
{
  const SHIM = "src/lib/.posting.fp.ts";
  fs.writeFileSync(
    SHIM,
    fs.readFileSync("src/lib/posting.ts", "utf8")
      .replace(/^import "server-only";.*$/m, "")
      .replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
  );
  let postVoucher;
  try { ({ postVoucher } = await import("../src/lib/.posting.fp.ts")); }
  finally { fs.unlinkSync(SHIM); }

  const tenant = await db.tenant.findFirst();
  const company = await db.company.create({
    data: { tenantId: tenant.id, code: "TESTCH", name: "Own Chart Contracting" },
  });
  // A chart that shares not one number with ours.
  const CHART = [
    ["A100", "Bank — Emirates NBD", "Asset", "bank"],
    ["A200", "Trade debtors", "Asset", "accountsReceivable"],
    ["L100", "Trade creditors", "Liability", "accountsPayable"],
    ["E500", "Staff costs", "Expense", "salaryExpense"],
  ];
  for (const [code, name, type] of CHART) {
    await db.chartOfAccount.create({ data: { companyId: company.id, code, name, type } });
  }
  await db.financePolicy.create({
    data: {
      companyId: company.id,
      accounts: JSON.stringify({
        ...DEFAULT_FINANCE_POLICY.accounts,
        ...Object.fromEntries(CHART.map(([code, , , role]) => [role, code])),
      }),
    },
  });

  const stored = await db.financePolicy.findUnique({ where: { companyId: company.id } });
  const policy = withFinanceDefaults({ ...stored, accounts: parseAccounts(stored.accounts) });
  ok("the company's own codes are read back", policy.accounts.bank === "A100" && policy.accounts.salaryExpense === "E500",
    `${policy.accounts.salaryExpense} / ${policy.accounts.bank}`);

  const salary = await db.chartOfAccount.findFirst({ where: { companyId: company.id, code: policy.accounts.salaryExpense } });
  const bank = await db.chartOfAccount.findFirst({ where: { companyId: company.id, code: policy.accounts.bank } });
  ok("both resolve to real accounts in that chart", !!salary && !!bank);

  const posted = await postVoucher({
    companyId: company.id,
    postedBy: "test",
    voucherType: "Payment",
    date: "2026-09-30",
    memo: "Payroll for 2026-09 — own chart",
    lines: [
      { accountId: salary.id, debit: 12000, credit: 0 },
      { accountId: bank.id, debit: 0, credit: 12000 },
    ],
    sourceType: "payroll",
    sourceId: "own-chart-test",
    source: "payroll",
  });
  ok("a payroll voucher posts into a chart that shares no code with ours",
    posted.ok, posted.ok ? posted.reference : posted.error);

  if (posted.ok) {
    const lines = await db.journalLine.findMany({
      where: { entry: { companyId: company.id } },
      include: { account: true },
    });
    ok("the cost landed on their staff-costs account",
      lines.some((l) => l.account.code === "E500" && l.debit === 12000));
    ok("and the money left their bank",
      lines.some((l) => l.account.code === "A100" && l.credit === 12000));
    ok("nothing was posted to a code from our default chart",
      !lines.some((l) => ["6000", "1000"].includes(l.account.code)));
  }

  // The vouchers go first. A journal line points at a chart-of-accounts row,
  // and that reference has no cascade — PostgreSQL refuses to drop the accounts
  // while lines still name them, where SQLite let it through. The application
  // never hits this: deleteCompany() refuses outright when a company holds
  // journals, and says to deactivate instead. The test has to clean up the way
  // the application would.
  await db.journalEntry.deleteMany({ where: { companyId: company.id } });
  await db.company.delete({ where: { id: company.id } });
  ok("the test company was removed cleanly",
    (await db.company.count({ where: { code: "TESTCH" } })) === 0);
}

/* ============================================== against the real records == */
{
  const companies = await db.company.findMany({ orderBy: { code: "asc" } });
  console.log("");
  for (const co of companies) {
    const stored = await db.financePolicy.findUnique({ where: { companyId: co.id } });
    const p = withFinanceDefaults(stored ? { ...stored, accounts: parseAccounts(stored.accounts) } : null);
    const chart = await db.chartOfAccount.findMany({ where: { companyId: co.id }, select: { code: true } });
    const have = new Set(chart.map((a) => a.code));
    const broken = ACCOUNT_ROLES.filter((r) => !have.has(p.accounts[r.key]));
    // A company with no chart at all has nothing to trade yet — WBM exists as
    // the isolation canary and is deliberately empty. Asserting against it
    // would be asserting that an unused company is misconfigured.
    const trading = chart.length > 0;
    console.log(`   ${co.code.padEnd(7)} ${stored ? "own settings" : "shipped defaults"}  VAT ${(p.vatRate * 100).toFixed(0)}%  CT ${(p.corporateTaxRate * 100).toFixed(0)}%  ${!trading ? "no chart yet" : broken.length ? `⚠ ${broken.length} role(s) unmapped` : "every role resolves"}`);
    ok(`${co.code}'s settings are valid`, validateFinancePolicy(p).length === 0);
    if (trading) {
      ok(`${co.code} can post everywhere the system needs to`, broken.length === 0,
        broken.map((b) => `${b.label} → ${p.accounts[b.key]}`).join(", "));
    }
  }
  console.log("");
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
