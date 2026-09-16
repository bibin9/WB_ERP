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
const { PurchaseOrderPdf, PO_WATERMARK } = docs.require("@/documents/purchase-order");

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

for (const status of ["Draft", "Awaiting approval", "Rejected", "Cancelled"]) {
  const l = readLayout(Buffer.from(await renderToBuffer(h(PurchaseOrderPdf, order([poLine(1)], { status })))));
  ok(`a ${status.toLowerCase()} order is marked ${PO_WATERMARK[status]} on the page`, l.pages[0].some((r) => r.rotated && r.text.includes(PO_WATERMARK[status])));
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
