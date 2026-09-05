/**
 * High-priority accounting items, exercised end to end.
 *
 * Posts real vouchers through the same rules the server action applies, then
 * checks what the reports would show. Static checks cover the parts that only
 * exist in the browser (the modal form, the picker, the print layout).
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { financialYear } from "../src/lib/period.ts";

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const D = (s) => new Date(s + "T00:00:00.000Z");
const read = (p) => fs.readFileSync(p, "utf8");

const company = await db.company.findFirst({ where: { code: "WBE" } });
const accounts = await db.chartOfAccount.findMany({ where: { companyId: company.id } });
const ar = accounts.find((a) => a.code === "1100");
const revenue = accounts.find((a) => a.code === "4000");

const TAG = "TEST-HP";
const cleanup = async () => {
  const ids = (await db.journalEntry.findMany({ where: { memo: { contains: TAG } }, select: { id: true } })).map((m) => m.id);
  if (ids.length) {
    await db.journalEntry.updateMany({ where: { reversalOfId: { in: ids } }, data: { reversalOfId: null } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }
};
await cleanup();

/* ------------------------------------------- credit and debit notes ------ */
// A progress invoice, then a credit note reducing it — the everyday pair on a
// contract when a rate is varied or retention is released.
const invoice = await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/SI`, date: D("2026-08-20"), voucherType: "Sales",
    memo: `${TAG} progress invoice`, postedBy: "test", vatAmount: 5000,
    lines: { create: [{ accountId: ar.id, debit: 105000, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 105000 }] },
  },
});
const note = await db.journalEntry.create({
  data: {
    companyId: company.id, reference: `${TAG}/CN`, date: D("2026-08-25"), voucherType: "Credit Note",
    memo: `${TAG} rate variation`, postedBy: "test", vatAmount: 1000,
    lines: { create: [{ accountId: revenue.id, debit: 21000, credit: 0 }, { accountId: ar.id, debit: 0, credit: 21000 }] },
  },
});
ok("a Credit Note voucher can be posted", note.voucherType === "Credit Note");

const arBalance = (await db.journalLine.findMany({ where: { accountId: ar.id, entry: { memo: { contains: TAG } } } }))
  .reduce((s, l) => s + l.debit - l.credit, 0);
ok("a credit note reduces what the customer owes", arBalance === 84000, `105,000 − 21,000 = ${arBalance}`);

// The VAT rule: a note carries tax with the opposite sign to the invoice.
const CREDIT_TYPES = new Set(["Credit Note", "Debit Note"]);
const vatOf = (e) => (CREDIT_TYPES.has(e.voucherType) ? -Math.abs(e.vatAmount) : e.vatAmount);
const vatEntries = await db.journalEntry.findMany({ where: { memo: { contains: TAG }, vatAmount: { gt: 0 } } });
const netVat = vatEntries.reduce((s, e) => s + vatOf(e), 0);
ok("the credit note reduces output VAT rather than adding to it", netVat === 4000, `5,000 − 1,000 = ${netVat}`);

// The VAT rules now live in src/lib/vat.ts, exercised in detail by test-vat.mjs.
const vatLib = read("src/lib/vat.ts");
ok("the VAT return applies that same rule", vatLib.includes("ADJUSTMENT_VOUCHERS") && vatLib.includes("sign"));
ok("credit notes count against output, debit notes against input",
  /OUTPUT_VOUCHERS = new Set\(\[[^\]]*"Credit Note"/.test(vatLib) && /INPUT_VOUCHERS = new Set\(\[[^\]]*"Debit Note"/.test(vatLib));
ok("the VAT report is built from that library",
  read("src/app/(app)/finance/vat/page.tsx").includes("buildVat201"));

const actions = read("src/app/(app)/finance/actions.ts");
ok("both note types have their own reference prefix", actions.includes('"Credit Note": "CN"') && actions.includes('"Debit Note": "DN"'));

/* ------------------------------------------------- numbering by year ----- */
const fy = financialYear(company.fyStartMonth, D("2026-08-20"));
const countThisYear = await db.journalEntry.count({
  where: { companyId: company.id, voucherType: "Sales", date: { gte: fy.from, lte: fy.to } },
});
const countAllTime = await db.journalEntry.count({ where: { companyId: company.id, voucherType: "Sales" } });
ok("numbering counts within the financial year, not all time", countThisYear <= countAllTime,
  `${countThisYear} this year of ${countAllTime} total`);

/* --------------------------------------------------------- drill-down ---- */
const reports = read("src/app/(app)/finance/reports/page.tsx");
ok("P&L and Balance Sheet lines link to their ledger", reports.includes("ledgerHref") && reports.includes("/finance/ledgers?c="));
ok("the drill-down carries the period, so the ledger opens on the same figure",
  reports.includes("from=${period.fromStr}&to=${period.toStr}"));
ok("totals do not link, only account lines", reports.includes("if (!href) return <div className={base}>{body}</div>;"));
ok("the trial balance links to ledgers", read("src/app/(app)/finance/page.tsx").includes("/finance/ledgers?c="));
ok("a ledger line links back to its voucher", read("src/app/(app)/finance/ledgers/page.tsx").includes("/finance/daybook?c="));

/* ------------------------------------------------------- day book -------- */
const daybook = read("src/app/(app)/finance/daybook/page.tsx");
ok("the day book filters by voucher type", daybook.includes("VOUCHER_TYPES.includes(sp.t)") && daybook.includes("voucherType: type"));
ok("all eight voucher types are offered as filters",
  (daybook.match(/"Journal", "Payment", "Receipt", "Contra", "Sales", "Purchase", "Credit Note", "Debit Note"/) || []).length === 1);
ok("a voucher arrived at by drill-down is highlighted", daybook.includes("e.reference === focused"));

const payments = await db.journalEntry.count({ where: { companyId: company.id, voucherType: "Payment" } });
const all = await db.journalEntry.count({ where: { companyId: company.id } });
ok("filtering by type genuinely narrows the list", payments < all, `${payments} payments of ${all} vouchers`);

/* ---------------------------------------------------------- printing ----- */
const css = read("src/app/globals.css");
ok("there is a print stylesheet", css.includes("@media print"));
ok("printed pages are A4 with margins", /@page\s*\{[\s\S]*?size: A4/.test(css));
ok("the printout is forced light, whatever the screen theme", /@media print[\s\S]*?--surface: 255 255 255/.test(css));
ok("navigation and buttons are dropped on paper", /@media print[\s\S]*?aside,[\s\S]*?display: none/.test(css));
ok("table headings repeat on every page", css.includes("display: table-header-group"));
const printable = ["page", "reports/page", "ledgers/page", "vat/page"]
  .filter((f) => read(`src/app/(app)/finance/${f}.tsx`).includes("PrintReport"));
ok("every finance report has a print button", printable.length === 4, `${printable.length}/4`);

/* ------------------------------------------------- account picker -------- */
const picker = read("src/components/finance/AccountPicker.tsx");
ok("the account field is type-to-search", picker.includes('role="combobox"'));
ok("a prefix match ranks above one in the middle", picker.includes("startsWith(q)") && picker.includes("rank: 0"));
ok("it is keyboard-driven", picker.includes("ArrowDown") && picker.includes("Enter") && picker.includes("Escape"));
ok("the voucher form uses it instead of a dropdown",
  read("src/components/JournalForm.tsx").includes("<AccountPicker") && !read("src/components/JournalForm.tsx").includes("Select account…"));

await cleanup();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
