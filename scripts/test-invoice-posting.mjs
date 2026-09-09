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

const { "invoice-posting": posting, vat } = await importLibs([
  "invoice-posting", "invoice", "posting", "accounts", "financepolicy", "money", "vat", "db", "period",
]);
const { issueInvoice, refreshInvoiceTotals, nextInvoiceNumber } = posting;
const { buildVat201, OUTPUT_VOUCHERS, INPUT_VOUCHERS } = vat;

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

  /* ================= the return, from what was posted =================== */
  /**
   * The VAT 201 reads every voucher line that carries a treatment and takes its
   * value as a taxable amount. That makes tagging the wrong line a quiet way to
   * misstate a legal filing: the tax on a reverse-charge import was briefly
   * tagged "Reverse charge" itself, which declared a 10,000 import as 11,000 and
   * the tax as 550 rather than 500. Nothing on any screen would have looked odd.
   *
   * So the boxes are built here from the lines an invoice really posted, rather
   * than from lines written by hand for the test.
   */
  {
    const vatLinesFor = async (entryId) => {
      const rows = await db.journalLine.findMany({ where: { entryId }, select: { debit: true, credit: true, vatTreatment: true } });
      const entry = await db.journalEntry.findUnique({ where: { id: entryId }, select: { voucherType: true } });
      return rows
        .filter((l) => l.vatTreatment)
        .map((l) => ({
          voucherType: entry.voucherType,
          treatment: l.vatTreatment,
          taxableValue: l.debit > 0 ? l.debit : l.credit,
        }));
    };
  
    // A plain sale of 1,000.
    {
      const d = await draft({ lines: [{ description: "Sale", quantity: 1, unitPrice: 1000, accountId: revenue.id }] });
      const res = await issueInvoice(d.id, "tester");
      ok("the sale for the VAT check issues", res.ok, res.ok ? "" : (res.problems ?? []).map((x) => x.message).join(" | ") || res.error);
      const box = buildVat201(await vatLinesFor(res.entryId));
      ok("a standard sale lands in box 1 at its net value",
        box.standardSupplies.amount === 1000 && box.standardSupplies.vat === 50,
        `${box.standardSupplies.amount} / ${box.standardSupplies.vat}`);
      ok("and nowhere else", box.zeroRatedSupplies === 0 && box.standardExpenses.amount === 0);
      ok("nothing is left unclassified", box.unclassified === 0);
    }
  
    // A reverse-charge import of 10,000. Boxes 3 and 10 must read the supply,
    // not the supply plus the tax on it.
    {
      const d = await draft({
        side: "Purchase",
        lines: [{ description: "Imported consultancy", quantity: 1, unitPrice: 10000, accountId: expense.id, vatTreatment: "Reverse charge" }],
      });
      const res = await issueInvoice(d.id, "tester");
      const box = buildVat201(await vatLinesFor(res.entryId));
  
      ok("a reverse-charge import declares the supply in box 3",
        box.reverseChargeSupplies.amount === 10000,
        `${box.reverseChargeSupplies.amount} — 10,500 would mean the tax was counted as supply`);
      ok("and reclaims the same in box 10", box.reverseChargeExpenses.amount === 10000);
      ok("the tax is 500, not 550",
        box.reverseChargeSupplies.vat === 500 && box.reverseChargeExpenses.vat === 500,
        `${box.reverseChargeSupplies.vat}`);
      ok("so it nets to nil, which is the whole point of the reverse charge",
        Math.abs(box.outputTax - box.inputTax) < 0.005, `${box.outputTax} vs ${box.inputTax}`);
  
      // The accounting still has both VAT lines; they simply carry no treatment.
      const rows = await db.journalLine.findMany({ where: { entryId: res.entryId } });
      ok("both VAT accounts were still posted", rows.length === 4, `${rows.length} lines`);
      ok("but the tax lines carry no treatment, because tax is not a supply",
        rows.filter((l) => l.vatTreatment).length === 1,
        "only the expense line is the supply");
    }
  
    // A mixed invoice: the boxes must split by treatment, not by document.
    {
      const d = await draft({
        lines: [
          { description: "Mainland work", quantity: 1, unitPrice: 2000, accountId: revenue.id },
          { description: "Export", quantity: 1, unitPrice: 3000, accountId: revenue.id, vatTreatment: "Zero-rated" },
          { description: "Bare land", quantity: 1, unitPrice: 500, accountId: revenue.id, vatTreatment: "Exempt" },
        ],
      });
      const res = await issueInvoice(d.id, "tester");
      const box = buildVat201(await vatLinesFor(res.entryId));
      ok("one invoice splits across three boxes",
        box.standardSupplies.amount === 2000 && box.zeroRatedSupplies === 3000 && box.exemptSupplies === 500,
        `${box.standardSupplies.amount} / ${box.zeroRatedSupplies} / ${box.exemptSupplies}`);
      ok("with tax only on the standard-rated part", box.outputTax === 100, `${box.outputTax}`);
    }
  
    // A credit note takes it back out.
    {
      const orig = await db.invoice.findFirst({ where: { number: `${MARK}-1` } });
      const d = await draft({
        docType: "Credit Note", originalInvoiceId: orig.id,
        lines: [{ description: "Returned", quantity: 1, unitPrice: 400, accountId: revenue.id }],
      });
      const res = await issueInvoice(d.id, "tester");
      const box = buildVat201(await vatLinesFor(res.entryId));
      ok("a credit note reduces box 1 rather than adding to it",
        box.standardSupplies.amount === -400 && box.standardSupplies.vat === -20,
        `${box.standardSupplies.amount} / ${box.standardSupplies.vat}`);
    }
  }

  await db.company.update({ where: { id: co.id }, data: { vatTRN: originalTrn } });
} finally {
  await cleanup();
}

/* ============ everything issuing requires can actually be set ========== */
/**
 * The VAT TRN and the structured address were added to the schema, made
 * mandatory for issuing, and left off the Companies form. The columns existed,
 * the check refused every invoice, and there was no screen anywhere that could
 * fill them in — so nothing could be issued at all and the only clue was a
 * refusal telling somebody to edit a field that was not there.
 *
 * A test that the column exists would have passed. This asks the question that
 * matters: is there a form that sets it, and an action that saves it.
 */
{
  const form = read("src/components/CompanyForm.tsx");
  const action = read("src/app/(app)/companies/actions.ts");
  const page = read("src/app/(app)/companies/page.tsx");

  for (const field of ["vatTRN", "addressLine", "city", "emirate"]) {
    ok(`${field} has a field on the Companies form`, form.includes(`name="${field}"`));
    ok(`and the form is told what is already stored`, page.includes(`${field}: c.${field}`), field);
  }
  ok("the save action reads all four", /taxIdentityFrom\(formData\)/.test(action));
  ok("on a new company as well as an edited one",
    (action.match(/taxIdentityFrom\(formData\)/g) ?? []).length === 2,
    "otherwise a company set up today has to be edited immediately afterwards");
  ok("the emirate is chosen, not typed",
    ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"]
      .every((e) => form.includes(`>${e}<`)),
    "seven of them, and a document is refused if it is spelt differently");
  ok("a TRN is stored without the spaces people type",
    /replace\(\/\[\\s-\]\/g, ""\)/.test(action),
    "the number on the invoice has to match the one the FTA holds");

  // And the round trip, because a form and an action can both look right.
  const before = { vatTRN: co.vatTRN, addressLine: co.addressLine, city: co.city, emirate: co.emirate };
  try {
    await db.company.update({
      where: { id: co.id },
      data: { vatTRN: "100999888700003", addressLine: "Plot 9", city: "Sharjah", emirate: "Sharjah" },
    });
    const saved = await db.company.findUnique({ where: { id: co.id } });
    ok("what is saved is read back", saved.vatTRN === "100999888700003" && saved.emirate === "Sharjah");

    const d = await draft({ lines: [{ description: "Reachability", quantity: 1, unitPrice: 100, accountId: revenue.id }] });
    const res = await issueInvoice(d.id, "tester");
    ok("and an invoice can then be issued", res.ok, res.ok ? "" : res.error);
  } finally {
    await db.company.update({ where: { id: co.id }, data: before });
  }
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
