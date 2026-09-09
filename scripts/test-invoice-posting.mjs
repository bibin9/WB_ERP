/**
 * An invoice becoming accounting.
 *
 * The document and the voucher are separate records, and this is the seam
 * between them. Four things have to hold or the ledger is wrong in a way that
 * a screen will not show:
 *
 *   - every voucher balances, on every document type and both sides;
 *   - a credit note is the same posting with every side reversed;
 *   - a reverse-charge purchase puts the tax on BOTH sides, because the
 *     supplier charged none and we account for it ourselves;
 *   - the same invoice cannot post twice, however hard it is pressed.
 *
 * Everything written here is removed again, whether it passes or not.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { "invoice-posting": posting, invoice: inv } = await importLibs([
  "invoice-posting", "invoice", "posting", "accounts", "financepolicy", "money", "vat", "db", "period",
]);
const { issueInvoice, refreshInvoiceTotals, nextInvoiceNumber } = posting;

const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");
const round = (n) => Math.round(n * 100) / 100;

const MARK = "INVTEST";
const co = await db.company.findFirst({ where: { code: "WBE" } });
const party = await db.party.findFirst({ where: { companyId: co.id, type: { in: ["Customer", "Both"] } } });
const revenue = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Income" } });
const expense = await db.chartOfAccount.findFirst({ where: { companyId: co.id, type: "Expense" } });
const acc = async (role) => {
  const codes = { ar: "1100", ap: "2000", vatIn: "1150", vatOut: "2150" };
  return db.chartOfAccount.findFirst({ where: { companyId: co.id, code: codes[role] } });
};

const cleanup = async () => {
  const invs = await db.invoice.findMany({ where: { number: { startsWith: MARK } }, select: { id: true, entryId: true } });
  await db.invoiceLine.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } });
  await db.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } });
  for (const e of invs.map((i) => i.entryId).filter(Boolean)) {
    await db.journalEntry.delete({ where: { id: e } }).catch(() => {});
  }
  await db.journalEntry.deleteMany({ where: { companyId: co.id, sourceType: "invoice", memo: { contains: MARK } } });
};
await cleanup();

let seq = 0;
const draft = async ({ side = "Sales", docType = "Invoice", lines, originalInvoiceId = null }) => {
  const d = await db.invoice.create({
    data: {
      companyId: co.id, side, docType, status: "Draft",
      number: `${MARK}-${++seq}`, issueDate: new Date("2026-06-15T00:00:00Z"),
      partyId: party.id, partyName: party.name, partyTrn: "100987654300003",
      originalInvoiceId,
      lines: { create: lines.map((l, i) => ({ order: i, unitCode: "EA", ...l })) },
    },
  });
  return d;
};

const linesOf = async (entryId) =>
  db.journalLine.findMany({ where: { entryId }, include: { account: { select: { code: true } } } });

const balanced = (rows) =>
  Math.abs(rows.reduce((t, l) => t + l.debit, 0) - rows.reduce((t, l) => t + l.credit, 0)) < 0.005;

try {
  // A tax invoice needs our own TRN, and this company had no field for one
  // until now — so set it, and put it back at the end.
  const originalTrn = co.vatTRN;
  await db.company.update({ where: { id: co.id }, data: { vatTRN: "100123456700003" } });

  /* ================= a sale ============================================ */
  {
    const d = await draft({ lines: [{ description: "Cable tray", quantity: 10, unitPrice: 100, accountId: revenue.id }] });
    const res = await issueInvoice(d.id, "tester");
    ok("a complete invoice issues", res.ok, res.ok ? res.reference : res.error);

    const rows = await linesOf(res.entryId);
    ok("the voucher balances", balanced(rows), rows.map((r) => `${r.account.code} ${r.debit}/${r.credit}`).join(" "));

    const ar = rows.find((r) => r.account.code === "1100");
    const rev = rows.find((r) => r.account.code === revenue.code);
    const vat = rows.find((r) => r.account.code === "2150");
    ok("receivables are debited with the gross", ar?.debit === 1050, `${ar?.debit}`);
    ok("revenue is credited with the net", rev?.credit === 1000, `${rev?.credit}`);
    ok("VAT output is credited with the tax", vat?.credit === 50, `${vat?.credit}`);

    const saved = await db.invoice.findUnique({ where: { id: d.id } });
    ok("the document is marked issued", saved.status === "Issued" && !!saved.entryId);
    ok("its totals are frozen on the row", saved.netTotal === 1000 && saved.vatTotal === 50 && saved.grossTotal === 1050);
    ok("the tax breakdown is stored for transmission", JSON.parse(saved.taxBreakdown)[0].categoryCode === "S");
    ok("our TRN is snapshotted, so a later change cannot rewrite it", saved.sellerTrn === "100123456700003");
    ok("and who issued it, and when", saved.issuedBy === "tester" && !!saved.issuedAt);

    // Pressing Issue twice is the obvious way to double the revenue.
    const again = await issueInvoice(d.id, "tester");
    ok("it cannot be issued a second time", !again.ok, again.ok ? "IT POSTED TWICE" : again.error);
    ok("and the second attempt says why", !again.ok && /already been issued/.test(again.error));
  }

  /* ================= a credit note reverses it ========================= */
  {
    const orig = await db.invoice.findFirst({ where: { number: `${MARK}-1` } });
    const d = await draft({
      docType: "Credit Note", originalInvoiceId: orig.id,
      lines: [{ description: "Cable tray returned", quantity: 4, unitPrice: 100, accountId: revenue.id }],
    });
    const res = await issueInvoice(d.id, "tester");
    ok("a credit note issues once it names its invoice", res.ok, res.ok ? res.reference : res.error);

    const rows = await linesOf(res.entryId);
    ok("it balances too", balanced(rows));
    const ar = rows.find((r) => r.account.code === "1100");
    const rev = rows.find((r) => r.account.code === revenue.code);
    ok("receivables are credited, not debited", ar?.credit === 420 && ar?.debit === 0, `${ar?.debit}/${ar?.credit}`);
    ok("revenue is debited back", rev?.debit === 400, `${rev?.debit}`);
    ok("every side is reversed, not just the sign on one line",
      rows.every((r) => r.debit === 0 || r.credit === 0));
  }
  {
    const d = await draft({
      docType: "Credit Note",
      lines: [{ description: "Orphan", quantity: 1, unitPrice: 100, accountId: revenue.id }],
    });
    const res = await issueInvoice(d.id, "tester");
    ok("a credit note that names no invoice is refused", !res.ok);
    ok("and nothing was posted", (await db.invoice.findUnique({ where: { id: d.id } })).entryId === null);
    ok("the refusal lists what to fix", !res.ok && res.problems?.length > 0,
      res.ok ? "" : res.problems?.[0]?.message);
  }

  /* ================= a supplier's bill ================================= */
  {
    const d = await draft({
      side: "Purchase",
      lines: [{ description: "Site consumables", quantity: 1, unitPrice: 2000, accountId: expense.id }],
    });
    const res = await issueInvoice(d.id, "tester");
    ok("a purchase issues", res.ok, res.ok ? res.reference : res.error);

    const rows = await linesOf(res.entryId);
    ok("it balances", balanced(rows));
    const ap = rows.find((r) => r.account.code === "2000");
    const exp = rows.find((r) => r.account.code === expense.code);
    const vatIn = rows.find((r) => r.account.code === "1150");
    ok("payables are credited with the gross", ap?.credit === 2100, `${ap?.credit}`);
    ok("the cost is debited with the net", exp?.debit === 2000, `${exp?.debit}`);
    ok("VAT input is debited, not output credited", vatIn?.debit === 100 && !rows.some((r) => r.account.code === "2150"));
  }

  /* ================= reverse charge, both sides ======================== */
  {
    const d = await draft({
      side: "Purchase",
      lines: [{ description: "Consultancy from abroad", quantity: 1, unitPrice: 10000, accountId: expense.id, vatTreatment: "Reverse charge" }],
    });
    const res = await issueInvoice(d.id, "tester");
    ok("a reverse-charge purchase issues", res.ok, res.ok ? res.reference : res.error);

    const rows = await linesOf(res.entryId);
    ok("it balances", balanced(rows), rows.map((r) => `${r.account.code} ${r.debit}/${r.credit}`).join(" "));

    const ap = rows.find((r) => r.account.code === "2000");
    ok("the supplier is owed the net only, because they charged no tax",
      ap?.credit === 10000, `${ap?.credit}`);

    const vatIn = rows.find((r) => r.account.code === "1150");
    const vatOut = rows.find((r) => r.account.code === "2150");
    ok("VAT input is debited with the tax we account for", vatIn?.debit === 500, `${vatIn?.debit}`);
    ok("and VAT output is credited with the same", vatOut?.credit === 500, `${vatOut?.credit}`);
    ok("so it nets to nil and appears in both halves of the return",
      round((vatIn?.debit ?? 0) - (vatOut?.credit ?? 0)) === 0,
      "posting only the payable would understate box 3 and box 10 together");
  }

  /* ================= a draft's totals ================================== */
  {
    const d = await draft({
      lines: [
        { description: "A", quantity: 2, unitPrice: 300, accountId: revenue.id },
        { description: "B", quantity: 1, unitPrice: 400, accountId: revenue.id, vatTreatment: "Zero-rated" },
      ],
    });
    await refreshInvoiceTotals(d.id);
    const after = await db.invoice.findUnique({ where: { id: d.id }, include: { lines: true } });
    ok("a draft's totals are computed from its lines",
      after.netTotal === 1000 && after.vatTotal === 30 && after.grossTotal === 1030,
      `${after.netTotal}/${after.vatTotal}/${after.grossTotal}`);
    ok("and each line carries its own rate and tax",
      after.lines.find((l) => l.description === "A").vatAmount === 30 &&
      after.lines.find((l) => l.description === "B").vatRate === 0);
    ok("the breakdown holds both categories",
      JSON.parse(after.taxBreakdown).length === 2);

    const res = await issueInvoice(d.id, "tester");
    ok("it issues", res.ok, res.ok ? "" : res.error);
    // An issued document's figures are what was issued, not what the
    // arithmetic says today.
    await refreshInvoiceTotals(d.id);
    const frozen = await db.invoice.findUnique({ where: { id: d.id } });
    ok("recalculating an issued invoice changes nothing", frozen.netTotal === 1000 && frozen.status === "Issued");
  }

  /* ================= numbering ========================================= */
  {
    const n1 = await nextInvoiceNumber(co.id, "Invoice");
    ok("a sales number is prefixed with the company code", n1.startsWith(`${co.code}/INV/`), n1);
    ok("a credit note has its own series", (await nextInvoiceNumber(co.id, "Credit Note")).includes("/CN/"));
  }

  await db.company.update({ where: { id: co.id }, data: { vatTRN: originalTrn } });
} finally {
  await cleanup();
}

/* ================= how it is wired in ================================== */
{
  const src = read("src/lib/invoice-posting.ts");
  ok("it posts through the one seam every module uses", /postVoucher\(/.test(src));
  ok("and does not write journal lines itself", !/journalEntry\.create/.test(src),
    "the closed-period lock, numbering and balance check all live there");
  ok("the invoice is the source document, so the seam's index stops a double post",
    /sourceType: "invoice"/.test(src) && /sourceId: inv\.id/.test(src));
  // Compare the calls, not the prose: the header comment names postVoucher()
  // several paragraphs before the code reaches it.
  ok("nothing is written until the document has passed its own check",
    src.indexOf("checkInvoice({") > 0 &&
    src.indexOf("checkInvoice({") < src.indexOf("await postVoucher({"),
    "an invoice that cannot be transmitted should never reach a customer");
  ok("the accounts come from the company's finance policy, not hard-coded codes",
    /accountsForPosting\(/.test(src) && !/"1100"|"2150"/.test(src));

  const schema = read("prisma/schema.prisma");
  ok("a company can now hold its own VAT TRN", /vatTRN\s+String\?/.test(schema));
  ok("addresses are structured, not one free-text line", /emirate\s+String\?/.test(schema));
  ok("a note is linked to the document it adjusts", /originalInvoiceId String\?/.test(schema));
  ok("an invoice maps to at most one voucher", /entryId String\?\s+@unique/.test(schema));
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
