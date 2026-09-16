/**
 * The printed documents, checked on the page rather than by eye.
 *
 * Each document is drawn with invented data and read back as positions: the
 * letterhead and footer on every page and inside the sheet, page numbers that
 * count, nothing drawn over anything else, a table heading that does not
 * repeat after the table has ended. These are the defects that reached a PDF
 * that "looked fine" when opened.
 */
import React from "react";
import { loadDocuments, readLayout, overlaps } from "./lib-documents.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

const docs = loadDocuments();
const { renderToBuffer } = docs.require("@react-pdf/renderer");
const { letterheadFor } = docs.require("@/lib/document-settings");
const h = React.createElement;

const COMPANY = {
  name: "White & Bright Engineering LLC",
  addressLine: "Office 1204, Churchill Tower",
  city: "Business Bay",
  emirate: "Dubai",
  vatTRN: "100123456700003",
};
const SETTINGS = { phone: "+971 4 555 0100", email: "info@wandb.ae", footerNote: "Trade licence no. 123456 · P.O. Box 4521, Dubai" };
const lh = letterheadFor(COMPANY, SETTINGS);

/**
 * The checks every document must pass, whatever it is.
 * `expectPages` is a minimum: a long document must actually run over.
 */
async function checkDocument(label, element, { heading, expectPages = 1 } = {}) {
  const layout = readLayout(Buffer.from(await renderToBuffer(element)));
  const { pages, width, height } = layout;
  ok(`${label}: runs to ${expectPages === 1 ? "a page" : `at least ${expectPages} pages`}`, pages.length >= expectPages, `${pages.length} page(s)`);

  const outside = pages.flatMap((p, i) =>
    p.filter((r) => !r.rotated && (r.top < 0 || r.top > height || r.left < 0 || r.left > width)).map((r) => `p${i + 1} "${r.text.trim()}" at ${Math.round(r.top)}`),
  );
  ok(`${label}: every line is on the sheet`, outside.length === 0, outside.slice(0, 3).join("; ") || `${pages.flat().length} lines`);

  const n = pages.length;
  pages.forEach((runs, i) => {
    const page = `${label} page ${i + 1}`;
    const name = runs.find((r) => r.text.includes(lh.companyName) && r.top < 90);
    ok(`${page}: letterhead at the top`, !!name, name ? `at ${Math.round(name.top)}` : "missing");
    const number = runs.find((r) => r.text.trim() === `Page ${i + 1} of ${n}`);
    ok(`${page}: numbered "Page ${i + 1} of ${n}" in the footer`, !!number && number.top > height - 72, number ? `at ${Math.round(number.top)} of ${Math.round(height)}` : "missing");
    const foot = runs.find((r) => r.text.includes(COMPANY.addressLine) && r.top > height - 72);
    ok(`${page}: footer line in the footer`, !!foot);
    const clash = overlaps(runs);
    ok(`${page}: nothing drawn over anything else`, clash.length === 0, clash.slice(0, 2).map(([a, b, g]) => `"${a}" / "${b}" ${g}pt`).join("; "));
  });

  if (heading) {
    const count = pages.flat().filter((r) => r.text.trim().toUpperCase() === heading.toUpperCase()).length;
    ok(`${label}: the table heading is drawn once, not repeated on every page`, count === 1, `${count} time(s)`);
  }
  return layout;
}

/* ============================================================ quotation == */
const { QuotationPdf } = docs.require("@/documents/quotation");

const quote = (lines, extra = {}) => ({
  filename: "q.pdf",
  lh,
  number: "WBE/QTN/26/0004",
  revision: 1,
  status: "Issued",
  title: "Jetty crane power supply",
  issuedOn: new Date("2026-09-16T08:00:00Z"),
  validUntil: new Date("2026-10-29T08:00:00Z"),
  enquiry: "WBE/ENQ/26/0008",
  preparedBy: "Commercial manager",
  approvedBy: "Managing Director",
  customer: ["Deep Port Logistics FZC", "Plot 4, Khalifa Port", "Abu Dhabi", "TRN 100987654300003"],
  attention: "Ravi Krishnan",
  lines,
  total: lines.reduce((s, l) => s + l.amount, 0),
  rounding: 0,
  reproduced: false,
  terms: "Validity 45 days. Payment 45 days from invoice.",
  replaces: null,
  replacedBy: null,
  ...extra,
});
const line = (i) => ({ ref: `A.${i}`, description: `Cable pulling and termination, run ${i}`, unit: "Square metre", quantity: 10 + i, rate: 186.48, amount: 186.48 * (10 + i) });

await checkDocument("quotation, short", h(QuotationPdf, quote([1, 2, 3].map(line))), { heading: "Description" });
await checkDocument("quotation, 70 lines", h(QuotationPdf, quote(Array.from({ length: 70 }, (_, i) => line(i + 1)))), { heading: "Description", expectPages: 3 });

const draft = readLayout(Buffer.from(await renderToBuffer(h(QuotationPdf, quote([line(1)], { status: "Draft" })))));
ok("a draft quotation carries DRAFT across the page", draft.pages[0].some((r) => r.rotated && r.text.includes("DRAFT")));
const issued = readLayout(Buffer.from(await renderToBuffer(h(QuotationPdf, quote([line(1)])))));
ok("an issued one does not", !issued.pages.flat().some((r) => r.text.includes("DRAFT")));

/* ====================================================== purchase order == */
const { PurchaseOrderPdf, orderWatermark } = docs.require("@/documents/purchase-order");

const order = (lines, extra = {}) => ({
  filename: "po.pdf",
  lh,
  number: "WBE/PO/26/0012",
  status: "Approved",
  date: new Date("2026-09-16T08:00:00Z"),
  deliverBy: new Date("2026-09-23T08:00:00Z"),
  request: "WBE/MR/26/0031",
  job: "J-2604 — Jetty crane power supply",
  currency: "AED",
  supplier: ["Gulf Cables Trading LLC", "Warehouse 7, Al Quoz 3", "Dubai", "TRN 100555666700003"],
  supplierContact: ["Sanjay Menon", "+971 50 000 0000", "sales@gulfcables.ae"],
  deliverTo: ["Main Store", "Jebel Ali Industrial 1", lh.companyName],
  lines,
  total: lines.reduce((s, l) => s + l.amount, 0),
  notes: "Deliver cable on returnable drums.",
  terms: "1. Mill test certificates with every delivery.",
  raisedBy: "Procurement Officer",
  approvedBy: "Operations Manager",
  approvedAt: new Date("2026-09-16T10:00:00Z"),
  ...extra,
});
const poLine = (i) => ({ description: `XLPE cable 4C x 95 sq mm, drum ${i}`, unit: "M", quantity: 250, unitPrice: 42.75, amount: 10687.5, job: i % 5 === 0 ? "J-2611" : null });

await checkDocument("purchase order, short", h(PurchaseOrderPdf, order([1, 2, 5].map(poLine))), { heading: "Description" });
await checkDocument("purchase order, 60 lines", h(PurchaseOrderPdf, order(Array.from({ length: 60 }, (_, i) => poLine(i + 1)))), { heading: "Description", expectPages: 2 });

for (const [status, mark] of [["Draft", "DRAFT"], ["Awaiting approval", "NOT APPROVED"], ["Rejected", "REJECTED"], ["Cancelled", "CANCELLED"], ["On hold", "NOT APPROVED"]]) {
  const l = readLayout(Buffer.from(await renderToBuffer(h(PurchaseOrderPdf, order([poLine(1)], { status })))));
  ok(`a ${status.toLowerCase()} order is marked ${mark} on the page`, orderWatermark(status) === mark && l.pages[0].some((r) => r.rotated && r.text.includes(mark)));
}
for (const status of ["Approved", "Partly received", "Received"]) {
  const l = readLayout(Buffer.from(await renderToBuffer(h(PurchaseOrderPdf, order([poLine(1)], { status })))));
  ok(`a ${status.toLowerCase()} order carries no mark`, !l.pages.flat().some((r) => r.rotated));
}
const longJob = await checkDocument("purchase order, long job name", h(PurchaseOrderPdf, order([poLine(1)], {
  job: "J-0003 — ADNOC Ruwais refinery shutdown, variation 1: extra spools and supports for the east pipe rack",
})));
const widest = Math.max(...longJob.pages[0].filter((r) => r.size >= 9 && r.top < 260).map((r) => r.left + r.text.length * r.size * 0.5));
ok("  and the job name wraps inside the page", widest < longJob.width, `right edge about ${Math.round(widest)} of ${Math.round(longJob.width)}`);
const po = readLayout(Buffer.from(await renderToBuffer(h(PurchaseOrderPdf, order([poLine(5)])))));
const poText = po.pages.flat().map((r) => r.text).join(" ");
ok("a line for another job says which", poText.includes("For job J-2611"));
ok("the supplier is told to quote the order number", poText.includes("Quote this order number"));
ok("the total is in words", poText.includes("Ten Thousand Six Hundred Eighty-Seven"));

/* ================================================================ rfq == */
const { RfqPdf, RFQ_WATERMARK } = docs.require("@/documents/rfq");
const enquiry = (extra = {}) => ({
  filename: "rfq.pdf", lh, number: "WBE/RFQ/26/0009", status: "Sent",
  date: new Date("2026-09-16T08:00:00Z"), neededBy: new Date("2026-09-30T08:00:00Z"), job: "J-2604 — Jetty crane",
  supplier: ["Gulf Cables Trading LLC", "Warehouse 7, Al Quoz 3", "Dubai", "Attention: Sanjay Menon", "sales@gulfcables.ae"],
  askedBy: "Procurement Officer",
  lines: Array.from({ length: 6 }, (_, i) => ({ description: `XLPE cable 4C x ${16 * (i + 1)} sq mm`, unit: "M", quantity: 500 })),
  notes: "Delivery to Jebel Ali store.", terms: "Prices valid 30 days.", ...extra,
});
const rfqLayout = await checkDocument("enquiry to a supplier", h(RfqPdf, enquiry()), { heading: "Description" });
const rfqText = rfqLayout.pages.flat().map((r) => r.text).join(" ");
ok("the enquiry carries no prices of ours", !/\d,\d{3}\.\d{2}|\d+\.\d{2}/.test(rfqText.replace(/\d+ sq mm/g, "")), "no money figures on the page");
ok("  and tells the supplier it is not an order", rfqText.includes("not an order"));
await checkDocument("unaddressed enquiry", h(RfqPdf, enquiry({ supplier: null })));
for (const status of ["Awarded", "Cancelled"]) {
  const l = readLayout(Buffer.from(await renderToBuffer(h(RfqPdf, enquiry({ status })))));
  ok(`an ${status.toLowerCase()} enquiry is marked ${RFQ_WATERMARK[status]}`, l.pages[0].some((r) => r.rotated && r.text.includes(RFQ_WATERMARK[status])));
}

/* =================================================== material request == */
const { MaterialRequestPdf, requestWatermark } = docs.require("@/documents/material-request");
const request = (extra = {}) => ({
  filename: "mr.pdf", lh, number: "WBE/MR/26/0031", status: "Approved",
  raisedOn: new Date("2026-09-14T08:00:00Z"), neededBy: new Date("2026-09-20T08:00:00Z"),
  job: "J-2604 — Jetty crane", store: "MAIN — Main store", requestedBy: "Site Engineer",
  approvedBy: "Project Manager", approvedAt: new Date("2026-09-15T08:00:00Z"),
  lines: Array.from({ length: 30 }, (_, i) => ({ code: `CBL-${100 + i}`, description: `Cable gland 20mm, set ${i + 1}`, unit: "EA", quantity: 12, notes: i % 7 === 0 ? "Brass, not nickel plated" : null })),
  notes: "Needed before the shutdown.", followUps: ["Purchase order WBE/PO/26/0012"], ...extra,
});
await checkDocument("material request", h(MaterialRequestPdf, request()), { heading: "Description" });
// "Submitted" is the real waiting state. The first version of this document
// listed "Awaiting approval" instead, and a submitted request printed clean.
const mrDraft = readLayout(Buffer.from(await renderToBuffer(h(MaterialRequestPdf, request({ status: "Submitted", approvedBy: null, approvedAt: null })))));
ok("a submitted request, not yet approved, says NOT APPROVED", mrDraft.pages[0].some((r) => r.rotated && r.text.includes("NOT APPROVED")));
for (const [status, mark] of [["Draft", "DRAFT"], ["Rejected", "REJECTED"], ["Cancelled", "CANCELLED"], ["Approved", null], ["Ordered", null], ["Something new", "NOT APPROVED"]]) {
  ok(`  a request that is ${status.toLowerCase()} is marked ${mark ?? "nothing"}`, requestWatermark(status) === mark);
}

/* ========================================================= store notes == */
const { StoreNotePdf } = docs.require("@/documents/store-note");
const { NOTE_TITLES, hasStoreNote } = docs.require("@/lib/store-notes");
const note = (kind, extra = {}) => ({
  filename: "n.pdf", lh, kind, title: NOTE_TITLES[kind], reference: "DN-44120", date: new Date("2026-09-16T00:00:00Z"),
  store: "MAIN — Main store", toStore: kind === "Transfer out" ? "SITE — Ruwais site store" : null,
  party: kind === "Receipt" || kind === "Return to supplier" ? ["Gulf Cables Trading LLC", "Al Quoz 3", "Dubai"] : null,
  job: kind === "Issue" ? "J-2604 — Jetty crane" : null,
  lines: Array.from({ length: 4 }, (_, i) => ({ code: `CBL-${i}`, name: `XLPE cable drum ${i}`, unit: "M", quantity: 250, bin: "A-01", order: "WBE/PO/26/0012", inspection: "Pending", value: 10687.5 })),
  notes: ["Against purchase order WBE/PO/26/0012."], postedBy: "Storekeeper", showValues: kind === "Issue" || kind === "Transfer out", ...extra,
});
for (const kind of ["Receipt", "Issue", "Return to supplier", "Transfer out"]) {
  const l = await checkDocument(NOTE_TITLES[kind].toLowerCase(), h(StoreNotePdf, note(kind)), { heading: "Description" });
  const text = l.pages.flat().map((r) => r.text).join(" ");
  ok(`  titled ${NOTE_TITLES[kind]}`, text.includes(NOTE_TITLES[kind]));
  ok(`  ${kind === "Issue" || kind === "Transfer out" ? "shows" : "does not show"} what the stock cost`, text.includes("10,687.50") === (kind === "Issue" || kind === "Transfer out"));
}
ok("adjustments have no note — nobody hands anything over", !hasStoreNote("Adjustment in") && !hasStoreNote("Adjustment out"));
ok("both ends of a transfer have one", hasStoreNote("Transfer in") && hasStoreNote("Transfer out"));

/* ===================================================== material return == */
const { MaterialReturnPdf } = docs.require("@/documents/material-return");
const ret = (extra = {}) => ({
  filename: "r.pdf", lh, number: "WBE/RTN/26/0003", status: "Posted", date: new Date("2026-09-16T00:00:00Z"),
  job: "J-2604 — Jetty crane", store: "MAIN — Main store", returnedBy: "Site Supervisor",
  lines: [
    { code: "CBL-1", name: "XLPE cable", unit: "M", quantity: 80, condition: "Reusable", value: 3420, notes: null },
    { code: "CBL-2", name: "XLPE cable offcuts", unit: "M", quantity: 14, condition: "Scrap", value: 0, notes: "Under 3 m" },
  ],
  creditedToJob: 3420, notes: null, ...extra,
});
const retLayout = await checkDocument("material return note", h(MaterialReturnPdf, ret()), { heading: undefined });
const retText = retLayout.pages.flat().map((r) => r.text).join(" ");
ok("  reusable and scrap are printed apart", /Reusable/i.test(retText) && /Scrap/i.test(retText));
ok("  the job credit is stated once posted", retText.includes("3,420.00"));
const retDraft = readLayout(Buffer.from(await renderToBuffer(h(MaterialReturnPdf, ret({ status: "Draft" })))));
const retDraftText = retDraft.pages.flat().map((r) => r.text).join(" ");
ok("a draft return credits nothing on paper either", !retDraftText.includes("3,420.00") && retDraftText.includes("Not yet posted"));

/* ======================================================== tax invoice == */
const { TaxInvoicePdf, invoiceTitle, invoiceWatermark } = docs.require("@/documents/tax-invoice");
const invoice = (extra = {}) => {
  const lines = Array.from({ length: 5 }, (_, i) => ({
    description: `Progress claim ${i + 1} — electrical works, level ${i + 3}`, quantity: 1, unit: "Lump sum",
    unitPrice: 48000, discount: i === 2 ? 1500 : 0, net: 48000 - (i === 2 ? 1500 : 0), treatment: i === 4 ? "Reverse charge" : "Standard", rate: 5, vat: i === 4 ? 0 : (48000 - (i === 2 ? 1500 : 0)) * 0.05,
  }));
  const net = lines.reduce((s, l) => s + l.net, 0), vat = lines.reduce((s, l) => s + l.vat, 0);
  return {
    filename: "inv.pdf", lh: { ...lh, trn: "TRN 100123456700003" }, docType: "Invoice", status: "Issued", number: "WBE/INV/26/0101",
    issueDate: new Date("2026-09-16T00:00:00Z"), dueDate: new Date("2026-10-16T00:00:00Z"),
    sellerTrn: "100123456700003", sellerAddress: "Office 1204, Churchill Tower, Business Bay, Dubai",
    customer: ["Deep Port Logistics FZC", "Plot 4, Khalifa Port, Abu Dhabi"], customerTrn: "100987654300003",
    job: "J-2604 — Jetty crane", against: null, currency: "AED", lines,
    breakdown: [{ treatment: "Standard", ratePercent: 5, taxable: net - 48000, tax: vat }, { treatment: "Reverse charge", ratePercent: 0, taxable: 48000, tax: 0 }],
    netTotal: net, vatTotal: vat, grossTotal: net + vat, notes: "Bank: Emirates NBD, account ending 4401.", issuedBy: "Finance Manager", ...extra,
  };
};
const invLayout = await checkDocument("tax invoice", h(TaxInvoicePdf, invoice()), { heading: "Description" });
const invText = invLayout.pages.flat().map((r) => r.text).join(" ");
ok("  titled TAX INVOICE, as the FTA expects", invText.includes("TAX INVOICE"));
ok("  carries both TRNs", invText.includes("100123456700003") && invText.includes("TRN 100987654300003"));
ok("  VAT shown by rate", /VAT Standard at 5% on/.test(invText));
ok("  a discount column appears when a line is discounted", invText.includes("DISCOUNT") || invText.includes("Discount"));
ok("  reverse charge is explained", invText.includes("Reverse charge applies"));
const cn = readLayout(Buffer.from(await renderToBuffer(h(TaxInvoicePdf, invoice({ docType: "Credit Note", against: { number: "WBE/INV/26/0088", issueDate: new Date("2026-08-01T00:00:00Z") } })))));
const cnText = cn.pages.flat().map((r) => r.text).join(" ");
ok("a credit note is titled CREDIT NOTE and names the invoice it adjusts", cnText.includes("CREDIT NOTE") && cnText.includes("WBE/INV/26/0088") && invoiceTitle("Debit Note") === "DEBIT NOTE");
const invDraft = readLayout(Buffer.from(await renderToBuffer(h(TaxInvoicePdf, invoice({ status: "Draft" })))));
ok("a draft invoice is marked DRAFT and says it is not valid",
  invDraft.pages[0].some((r) => r.rotated && r.text.includes("DRAFT")) && invDraft.pages.flat().some((r) => /not a valid tax invoice/.test(r.text)));
ok("only an issued invoice prints clean", invoiceWatermark("Issued") === null && invoiceWatermark("Draft") === "DRAFT" && invoiceWatermark("Cancelled") === "CANCELLED" && invoiceWatermark("Anything") === "DRAFT");

/* ============================================================ payslips == */
const { PayslipsPdf, maskedBank, periodLabel, payslipWatermark } = docs.require("@/documents/payslip");
const slip = (i, extra = {}) => ({
  empNo: `E${1000 + i}`, name: `Employee Number ${i}`, designation: "Electrician", department: "MEP",
  bank: maskedBank("Emirates NBD", "AE07 0331 2345 6789 0123 456"), daysPaid: 30, daysInPeriod: 30, partMonthReason: null,
  basic: 3000, allowances: 1500, contractBasic: 3000, contractAllowances: 1500, otHours: 12, otPremiumHours: 4, overtime: 420,
  unpaidDays: 1, absence: 150, otherDeductions: 200, deductionNote: "Damaged tool", advanceRecovery: 500, netPay: 4070, ...extra,
});
const run = await checkDocument("payroll run, a page each", h(PayslipsPdf, {
  filename: "p.pdf", lh, period: "2026-08", status: "Approved", slips: [slip(1), slip(2), slip(3, { daysPaid: 12, partMonthReason: "Joined 19 Aug" })],
}), { expectPages: 3 });
ok("  exactly one page per employee", run.pages.length === 3, `${run.pages.length} pages`);
ok("  each page is that employee's", run.pages.every((p, i) => p.some((r) => r.text.includes(`Employee Number ${i + 1}`)) && !p.some((r) => r.text.includes(`Employee Number ${((i + 1) % 3) + 1}`))));
const slipText = run.pages[0].map((r) => r.text).join(" ");
ok("  the IBAN is never printed in full", !slipText.includes("0331 2345") && !slipText.includes("AE07") && slipText.includes("account ending 3456"), maskedBank("Emirates NBD", "AE07 0331 2345 6789 0123 456"));
ok("  net pay in words", slipText.includes("Four Thousand Seventy"));
ok("  the period is written out", periodLabel("2026-08") === "August 2026" && slipText.includes("August 2026"));
ok("  a part month shows the days behind the figure", run.pages[2].map((r) => r.text).join("").includes("12 of 30 days on 3,000.00"));
ok("a run not yet approved prints DRAFT", payslipWatermark("Draft") === "DRAFT" && payslipWatermark("Approved") === null && payslipWatermark("Paid") === null);
ok("no bank on file prints nothing rather than 'undefined'", maskedBank(null, null) === null && maskedBank("ADCB", "") === "ADCB");

/* ========================================================== settlement == */
const { SettlementPdf, settlementWatermark } = docs.require("@/documents/settlement");
const settlement = (extra = {}) => ({
  filename: "s.pdf", lh, status: "Approved", type: "Resignation",
  employee: { name: "Ahmed Khan", empNo: "E1042", designation: "Foreman", department: "Civil", joinDate: new Date("2019-03-01T00:00:00Z") },
  lastWorkingDay: new Date("2026-09-10T00:00:00Z"), serviceText: "7y 6m 9d", basicSalary: 4200,
  additions: [
    { label: "End-of-service gratuity", detail: "165 days of basic pay", amount: 23100 },
    { label: "Unused leave encashment", detail: "12 days", amount: 1656 },
    { label: "Repatriation air ticket", detail: "", amount: 1400 },
  ],
  deductions: 350, adjustment: -100, adjustmentNote: "Uniform not returned", net: 25706, preparedBy: "HR Officer", ...extra,
});
const setLayout = await checkDocument("final settlement", h(SettlementPdf, settlement()), { heading: "Entitlement" });
const setText = setLayout.pages.flat().map((r) => r.text).join(" ");
ok("  the employee's declaration is on it", setText.includes("full and final settlement of all my dues"));
ok("  deductions and adjustments shown as deductions", setText.includes("(350.00)") && setText.includes("(100.00)"));
ok("  signatures print even with signature boxes switched off",
  readLayout(Buffer.from(await renderToBuffer(h(SettlementPdf, settlement({ lh: { ...lh, showSignatures: false } }))))).pages.flat().some((r) => /EMPLOYEE$|^Employee$/i.test(r.text.trim())));
ok("an unapproved settlement prints DRAFT", settlementWatermark("Draft") === "DRAFT" && settlementWatermark("Approved") === null && settlementWatermark("Settled") === null);

/* ============================================ every real status is covered == */
// Each document decides its mark from its record's status. These walk the
// status lists the screens actually use, so a state added to one of them
// cannot print clean without somebody deciding it should.
const { quotationWatermark } = docs.require("@/documents/quotation");
const { QUOTE_STATUSES } = docs.require("@/lib/quoting");
const { PO_STATUSES, REQUEST_STATUS_HELP } = docs.require("@/lib/purchasing");
const cleanQuote = new Set(["Approved", "Issued", "Accepted", "Declined"]);
const cleanOrder = new Set(["Approved", "Partly received", "Received"]);
const cleanRequest = new Set(["Approved", "Ordered"]);
ok("every quotation status prints clean only once signed off",
  QUOTE_STATUSES.every((s) => (quotationWatermark(s) === null) === cleanQuote.has(s)),
  QUOTE_STATUSES.map((s) => `${s}: ${quotationWatermark(s) ?? "clean"}`).join(", "));
ok("every purchase order status prints clean only once approved",
  PO_STATUSES.every((s) => (orderWatermark(s) === null) === cleanOrder.has(s)),
  PO_STATUSES.map((s) => `${s}: ${orderWatermark(s) ?? "clean"}`).join(", "));
ok("every material request status prints clean only once approved",
  Object.keys(REQUEST_STATUS_HELP).every((s) => (requestWatermark(s) === null) === cleanRequest.has(s)),
  Object.keys(REQUEST_STATUS_HELP).map((s) => `${s}: ${requestWatermark(s) ?? "clean"}`).join(", "));

/* ============================================================== sample == */
const { SamplePdf } = docs.require("@/documents/sample");
await checkDocument("letterhead sample", h(SamplePdf, {
  filename: "s.pdf",
  lh,
  terms: "1. Prices exclude VAT.",
  lines: [{ description: "Testing and commissioning", unit: "Lump sum", quantity: 1, rate: 2200 }],
}));

docs.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
