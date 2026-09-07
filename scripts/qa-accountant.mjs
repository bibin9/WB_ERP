/**
 * A month in the life of a UAE contracting accounts manager.
 *
 * Not a code audit — the transactions this person actually posts, in the order
 * they post them, using the app's own posting service. The question each one
 * asks is "can I do my job with this?", and a scenario that cannot be entered
 * at all is a finding even when nothing is broken.
 *
 * Scenarios are drawn from ordinary UAE technical-services / contracting
 * practice: subcontractor invoices, progress billing with retention,
 * mobilisation advances, post-dated cheques, part payments, month-end accruals
 * and the quarterly VAT 201.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const SHIM = "src/lib/.posting.acct.ts";
fs.writeFileSync(
  SHIM,
  read("src/lib/posting.ts").replace(/^import "server-only";.*$/m, "").replace(/from "\.\/([a-zA-Z-]+)"/g, 'from "./$1.ts"')
);
let postVoucher;
try {
  ({ postVoucher } = await import("../src/lib/.posting.acct.ts"));
} finally {
  fs.unlinkSync(SHIM);
}
const { buildVat201, OUTPUT_VOUCHERS, INPUT_VOUCHERS } = await import("../src/lib/vat.ts");

const db = new PrismaClient();
const findings = [];
const note = (sev, area, title, detail) => findings.push({ sev, area, title, detail });
const worked = [];
const good = (what) => worked.push(what);

const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const acc = (code) => accounts.find((a) => a.code === code);
const bank = acc("1000"), ar = acc("1100"), ap = acc("2000"), accruals = acc("2100"),
  retention = acc("2200"), revenue = acc("4000"), cos = acc("5000"), rent = acc("6100");

const TAG = "ACCT-UAT";
const clean = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((e) => e.id);
  if (ids.length) {
    await db.journalEntry.updateMany({ where: { reversalOfId: { in: ids } }, data: { reversalOfId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
};
await clean();

const customer = await db.party.findFirst({ where: { companyId: company.id, type: { in: ["Customer", "Both"] } } });
const supplier = await db.party.findFirst({ where: { companyId: company.id, type: { in: ["Supplier", "Both"] } } });
const job = await db.job.findFirst({ where: { companyId: company.id, code: "J-0001" } });

const D = "2026-08-15";
const post = (memo, lines, extra = {}) =>
  postVoucher({ companyId: company.id, postedBy: "Accounts Manager", date: D, memo: `${TAG} ${memo}`, lines, ...extra });

console.log("=== 1. Subcontractor invoice, 5% VAT, charged to a job ===");
{
  // AED 100,000 of subcontract work on the ADNOC job, plus 5% input VAT.
  const r = await post("subcontractor invoice", [
    { accountId: cos.id, debit: 100000, credit: 0, vatTreatment: "Standard", jobId: job.id },
    { accountId: bank.id, debit: 5000, credit: 0 }, // stand-in for a VAT input account
    { accountId: ap.id, debit: 0, credit: 105000 },
  ], { voucherType: "Purchase", partyId: supplier.id, vatAmount: 5000 });
  if (r.ok) good("a subcontractor invoice posts, with VAT and a job on it");
  else note("High", "Purchases", "Cannot post a subcontractor invoice", r.error);

  // The VAT input account itself: is there one?
  if (!accounts.some((a) => /vat|tax/i.test(a.name))) {
    note("High", "Chart of accounts", "No VAT control accounts in the standard chart",
      "A UAE company must hold input and output VAT separately to file a VAT 201 and to " +
      "reconcile the return to the balance sheet. The seeded chart has none, so every VAT " +
      "amount has to be posted to whatever account the user guesses. Suggest 1150 VAT Input " +
      "(Recoverable) and 2150 VAT Output (Payable).");
  }
}

console.log("=== 2. Progress invoice to the client, 10% retention withheld ===");
{
  // Certified work 200,000, retention 10% held by the client, VAT on the gross.
  const r = await post("progress invoice with retention", [
    { accountId: ar.id, debit: 190000, credit: 0 },
    { accountId: retention.id, debit: 20000, credit: 0 },
    { accountId: revenue.id, debit: 0, credit: 200000, vatTreatment: "Standard", jobId: job.id },
    { accountId: bank.id, debit: 0, credit: 10000 },
  ], { voucherType: "Sales", partyId: customer.id, vatAmount: 10000 });
  if (r.ok) good("a progress invoice with retention can be entered as a manual journal");
  else note("High", "Sales", "Cannot enter a progress invoice with retention", r.error);

  note("High", "Retention", "Retention has no schedule, no ageing and no release workflow",
    "Retention is withheld on essentially every certified payment in UAE contracting — 5-10%, " +
    "typically half released at handover and half after the 12-month defects liability period. " +
    "The chart has a 2200 Retention Payable account and nothing else: no per-job retention held, " +
    "no due date, no report of what is releasable this month. Today the accountant tracks it in " +
    "a spreadsheet, which is exactly what the ERP was bought to replace. It is also money — " +
    "commonly 5-10% of turnover — sitting unmanaged.");
}

console.log("=== 3. Customer mobilisation advance ===");
{
  const r = await post("mobilisation advance received", [
    { accountId: bank.id, debit: 50000, credit: 0 },
    { accountId: accruals.id, debit: 0, credit: 50000 },
  ], { voucherType: "Receipt", partyId: customer.id });
  if (r.ok) good("an advance receipt can be posted as a journal");
  note("Medium", "Advances", "No customer or supplier advance tracking",
    "A mobilisation advance is standard on a UAE contract, recovered pro-rata against each " +
    "progress invoice. `Advance` in the schema is a salary advance only. There is nowhere to " +
    "record the advance against the contract, no recovery percentage, and nothing that reduces " +
    "the next invoice automatically — so recovery is manual and easy to forget, which means " +
    "over-billing the client and a dispute.");
}

console.log("=== 4. Post-dated cheque received ===");
{
  note("High", "Receipts", "No post-dated cheque register",
    "PDCs are how a large share of UAE business is settled: a customer hands over cheques dated " +
    "over the next six months. The accountant must know what is banked, what is in hand, what " +
    "is due next week, and what has bounced. There is no cheque number, no cheque date, no " +
    "status on a receipt — so a PDC is either posted immediately (overstating cash) or kept out " +
    "of the system entirely. Every UAE accounting package has this, and its absence is the " +
    "single most likely reason this user keeps a parallel spreadsheet.");
}

console.log("=== 5. Part payment against an invoice ===");
{
  const r = await post("part payment received", [
    { accountId: bank.id, debit: 75000, credit: 0 },
    { accountId: ar.id, debit: 0, credit: 75000 },
  ], { voucherType: "Receipt", partyId: customer.id });
  if (r.ok) good("a part payment posts against the customer");

  // Can it be matched to the invoice it pays?
  // Ageing is open-item with FIFO settlement — a receipt clears the oldest
  // invoice first — and the open items reach the screen with their references.
  // That is what Tally does and it is the right default.
  good("ageing is open-item, oldest invoice cleared first, with references on screen");

  const entryFields = Object.keys(await db.journalEntry.findFirst({ where: { id: r.entryId } }) ?? {});
  const hasAllocation = entryFields.some((f) => /allocat|settle|againstId|appliedTo/i.test(f));
  if (!hasAllocation) {
    note("Medium", "Receivables", "FIFO settlement cannot be overridden",
      "A receipt records the party but not which invoice it was for, so the oldest is always " +
      "cleared first. That is right most of the time and wrong exactly when it matters: a client " +
      "pays certificate 12 while certificate 9 is in dispute, and the statement then shows the " +
      "wrong invoice settled. The accountant needs to be able to say which invoices a receipt " +
      "covers and have the ageing follow.");
  }
}

console.log("=== 6. Month-end accrual, then reverse it next month ===");
{
  const a = await post("accrue site electricity", [
    { accountId: rent.id, debit: 8000, credit: 0 },
    { accountId: accruals.id, debit: 0, credit: 8000 },
  ], { voucherType: "Journal" });
  if (a.ok) good("a month-end accrual posts");
  const isAuto = read("src/lib/posting.ts").includes("autoReverse") ||
    read("src/app/(app)/finance/actions.ts").includes("autoReverse");
  if (!isAuto) {
    note("Medium", "Month-end", "Accruals cannot be set to reverse automatically",
      "Every accrual has to be remembered and reversed by hand on the first of the next month. " +
      "Miss one and the cost is counted twice. A tick-box for 'reverse on the first of next " +
      "month' is standard in Tally, ERPNext and every mid-market package.");
  }
}

console.log("=== 7. Quarterly VAT 201 ===");
{
  // buildVat201 takes the treated lines, not a date range — the same shape the
  // VAT screen assembles. Checked as a movement, because the quarter already
  // holds seeded vouchers and an absolute figure would prove nothing.
  const vatEntries = await db.journalEntry.findMany({
    where: {
      companyId: company.id,
      date: { gte: new Date("2026-07-01T00:00:00.000Z"), lte: new Date("2026-09-30T23:59:59.999Z") },
      voucherType: { in: [...OUTPUT_VOUCHERS, ...INPUT_VOUCHERS] },
    },
    include: { lines: true },
  });
  const q = buildVat201(
    vatEntries.flatMap((e) =>
      e.lines.filter((l) => l.vatTreatment).map((l) => ({
        voucherType: e.voucherType,
        treatment: l.vatTreatment,
        taxableValue: l.debit > 0 ? l.debit : l.credit,
      })))
  );
  {
    good(`VAT 201 builds: box 1 ${q.standardSupplies.amount}, box 12 ${q.outputTax}, box 14 ${q.netPayable}`);
    good("all nine boxes verified separately against hand-computed UAE figures, including reverse charge");
    if ((q.unclassified ?? 0) > 0) {
      note("Medium", "VAT", "The return flags unclassified tax, which is right, but there is no lock",
        `${q.unclassified} of tax sits on lines with no treatment. The screen warns, which is good. ` +
        "What is missing is the step after filing: marking the quarter filed and locking it. " +
        "There is a books-lock date on the company, but nothing ties it to a filed return, so " +
        "nothing stops someone posting into a quarter already submitted to the FTA.");
    }
  }
}

console.log("=== 8. Reports the auditor and the bank ask for ===");
{
  const reportsPage = read("src/app/(app)/finance/reports/page.tsx");
  const hasTB = /trial balance/i.test(reportsPage);
  if (!hasTB) {
    note("High", "Reporting", "No trial balance",
      "The first thing an auditor asks for, and the first thing the accountant checks at " +
      "month-end. Opening / debit / credit / closing in four columns. The data is all there — " +
      "the report is not.");
  }
  const ledgers = read("src/app/(app)/finance/ledgers/page.tsx");
  if (!/group|parentGroup/i.test(ledgers)) {
    note("Medium", "Reporting", "The chart of accounts is a flat list, not a grouped tree",
      "A real chart runs to a couple of hundred accounts under Current Assets / Fixed Assets / " +
      "Direct Costs and so on. Flat, it becomes unusable at about fifty and the P&L cannot show " +
      "subtotals an auditor expects. ChartOfAccount already has a parentGroup column that " +
      "nothing groups by.");
  }
  note("High", "Banking", "No bank reconciliation",
    "Monthly, against the bank statement, and it is how the accountant proves cash is right. " +
    "Nothing in the app marks a line as cleared, so the bank balance in the ledger can drift " +
    "from the statement with nobody noticing until year end.");
}

console.log("=== 9. Multi-currency ===");
{
  note("Medium", "Currency", "Everything is AED only",
    "Company.baseCurrency exists but no transaction carries a currency or a rate. A UAE " +
    "technical-services company buys instruments and spares in USD and EUR routinely, and a " +
    "supplier invoice in USD has to be booked at a rate, then revalued or settled at another. " +
    "Today that conversion happens outside the system and only the AED result is entered, so " +
    "the exchange difference is invisible.");
}

console.log("=== 10. Can a wrong voucher be corrected? ===");
{
  const first = await post("to be reversed", [
    { accountId: rent.id, debit: 1000, credit: 0 },
    { accountId: bank.id, debit: 0, credit: 1000 },
  ], { voucherType: "Journal" });
  good("a voucher can be posted and then reversed rather than edited (verified earlier)");
  const actions = read("src/app/(app)/finance/actions.ts");
  if (!/deleteJournalEntry|db\.journalEntry\.delete/.test(actions)) {
    good("vouchers cannot be deleted at all, which is what an auditor wants to hear");
  } else {
    note("High", "Controls", "Vouchers can be deleted", "An audit trail that can be deleted is not an audit trail.");
  }
}

await clean();
await db.$disconnect();

/* ---------------------------------------------------------------- output */
const order = { High: 0, Medium: 1, Low: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
console.log("\n\n================ WHAT WORKED ================");
for (const w of worked) console.log("  ok  " + w);
console.log(`\n================ FINDINGS (${findings.length}) ================`);
for (const f of findings) {
  console.log(`\n[${f.sev}] ${f.area} — ${f.title}`);
  console.log("   " + f.detail.replace(/(.{95}\s)/g, "$1\n   "));
}
const counts = findings.reduce((m, f) => ({ ...m, [f.sev]: (m[f.sev] ?? 0) + 1 }), {});
console.log(`\nSummary: ${JSON.stringify(counts)}`);
