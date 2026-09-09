/**
 * The invoice document: what it comes to, and whether it may be issued.
 *
 * The rule that carries the most weight is the tax breakdown. A PINT AE
 * document must group tax by VAT category, and a validator rejects it unless
 * those groups sum to the header tax — so the two are asserted against each
 * other on every shape of invoice here, not just computed side by side.
 *
 * The second is that every figure goes through toFils on the way in. A VAT
 * extraction gives 55.9995, and rounding on the screen instead of in the
 * arithmetic is how a return comes to disagree with itself.
 */
import { importLibs } from "./lib-shim.mjs";

const { invoice } = await importLibs(["invoice", "money", "vat"]);
const {
  UNIT_CODES, DEFAULT_UNIT_CODE, unitLabel, DOC_TYPES, INVOICE_STATUSES, INVOICE_SIDES,
  VAT_CATEGORY_CODE, lineTotals, invoiceTotals, checkInvoice, dueDateFrom,
} = invoice;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const RATE = 0.05;

const line = (o = {}) => ({
  description: "Cable tray installation", quantity: 1, unitCode: "EA",
  unitPrice: 1000, vatTreatment: "Standard", accountId: "acc-1", ...o,
});

/* ===================== units of measure ================================= */

ok("units are UN/ECE codes, which is what goes on the wire",
  UNIT_CODES.some((u) => u.code === "HUR") && UNIT_CODES.some((u) => u.code === "MTK"));
ok("each is the default", DEFAULT_UNIT_CODE === "EA");
ok("a code reads as words for the person choosing it", unitLabel("MTQ") === "Cubic metre");
ok("an unknown code shows itself rather than an empty box", unitLabel("XYZ") === "XYZ");
ok("no code appears twice", new Set(UNIT_CODES.map((u) => u.code)).size === UNIT_CODES.length);

/* ===================== VAT category codes =============================== */

// Fixed by the specification, not chosen by us.
ok("standard is S", VAT_CATEGORY_CODE["Standard"] === "S");
ok("zero-rated is Z", VAT_CATEGORY_CODE["Zero-rated"] === "Z");
ok("exempt is E", VAT_CATEGORY_CODE["Exempt"] === "E");
ok("out of scope is O", VAT_CATEGORY_CODE["Out of scope"] === "O");
ok("reverse charge is AE", VAT_CATEGORY_CODE["Reverse charge"] === "AE");
ok("every treatment the system offers has a category code",
  Object.keys(VAT_CATEGORY_CODE).length === 5);

/* ===================== one line ========================================= */
{
  const t = lineTotals(line({ quantity: 3, unitPrice: 250 }), RATE);
  ok("net is quantity times price", t.net === 750);
  ok("tax is the rate on the net", t.vat === 37.5);
  ok("gross is the two together", t.gross === 787.5);
  ok("the rate is carried as a percentage for the document", t.vatRate === 5);
}
{
  const t = lineTotals(line({ quantity: 2, unitPrice: 500, discount: 150 }), RATE);
  ok("a discount comes off before tax", t.net === 850 && t.vat === 42.5,
    "otherwise the customer is taxed on money they did not pay");
}
for (const [treatment, tax] of [["Zero-rated", 0], ["Exempt", 0], ["Out of scope", 0], ["Reverse charge", 0]]) {
  const t = lineTotals(line({ vatTreatment: treatment }), RATE);
  ok(`${treatment} carries no tax on the document`, t.vat === tax && t.vatRate === 0);
  ok(`and ${treatment} still has a net amount`, t.net === 1000);
}
{
  // 3 x 373.33 is 1,119.99 and 5% of that is 55.9995. Rounding on the screen
  // instead of here is how a return stops agreeing with itself.
  const t = lineTotals(line({ quantity: 3, unitPrice: 373.33 }), RATE);
  ok("an awkward extraction is rounded to fils in the arithmetic",
    t.net === 1119.99 && t.vat === 56, `${t.net} / ${t.vat}`);
  ok("and gross is the rounded parts, not a re-rounded product", t.gross === 1175.99, `${t.gross}`);
}
ok("a negative quantity cannot make a negative line",
  lineTotals(line({ quantity: -5 }), RATE).net === 0, "a refund is a credit note, not a minus sign");

/* ===================== the tax breakdown ================================ */
{
  const lines = [
    line({ unitPrice: 1000 }),
    line({ unitPrice: 500 }),
    line({ unitPrice: 2000, vatTreatment: "Zero-rated" }),
    line({ unitPrice: 300, vatTreatment: "Exempt" }),
  ];
  const t = invoiceTotals(lines, RATE);

  ok("the header totals are the sum of the lines", t.net === 3800 && t.vat === 75 && t.gross === 3875);
  ok("one group per category, not one per line", t.breakdown.length === 3, `${t.breakdown.length}`);

  // The rule a PINT AE validator applies.
  const groupedTax = t.breakdown.reduce((s, g) => s + g.tax, 0);
  const groupedNet = t.breakdown.reduce((s, g) => s + g.taxable, 0);
  ok("the groups sum to the header tax", Math.abs(groupedTax - t.vat) < 0.005, `${groupedTax} vs ${t.vat}`);
  ok("and to the header net", Math.abs(groupedNet - t.net) < 0.005, `${groupedNet} vs ${t.net}`);

  const std = t.breakdown.find((g) => g.categoryCode === "S");
  ok("the standard group carries its rate and taxable amount",
    std.taxable === 1500 && std.tax === 75 && std.ratePercent === 5);
  ok("a zero-rated group is present with tax of nothing, not absent",
    t.breakdown.some((g) => g.categoryCode === "Z" && g.taxable === 2000 && g.tax === 0),
    "an omitted category is a rejected document");
  ok("the largest group comes first", t.breakdown[0].taxable >= t.breakdown[1].taxable);
}
{
  const t = invoiceTotals([], RATE);
  ok("an empty invoice is zero, not a crash", t.net === 0 && t.vat === 0 && t.breakdown.length === 0);
}
{
  // Many small lines are where rounding drift would show up.
  const lines = Array.from({ length: 40 }, () => line({ quantity: 1, unitPrice: 33.33 }));
  const t = invoiceTotals(lines, RATE);
  const groupedTax = t.breakdown.reduce((s, g) => s + g.tax, 0);
  ok("forty awkward lines still balance to the header",
    Math.abs(groupedTax - t.vat) < 0.005 && Math.abs(t.net + t.vat - t.gross) < 0.005,
    `${t.net} + ${t.vat} = ${t.gross}`);
}

/* ===================== may it be issued? ================================ */

const good = {
  side: "Sales", docType: "Invoice", issueDate: new Date("2026-09-01T00:00:00Z"),
  sellerTrn: "100123456700003", partyName: "Al Habtoor LLC", partyTrn: "100987654300003",
  lines: [line()],
};

ok("a complete invoice has nothing to fix", checkInvoice(good).length === 0,
  checkInvoice(good).map((p) => p.message).join(" | "));

const at = (input, field) => checkInvoice(input).find((p) => p.field === field);

ok("a missing date is caught", !!at({ ...good, issueDate: null }, "issueDate"));
ok("our own TRN missing is caught", !!at({ ...good, sellerTrn: null }, "sellerTrn"));
ok("and the message says where to put it",
  /Companies/.test(at({ ...good, sellerTrn: null }, "sellerTrn").message),
  at({ ...good, sellerTrn: null }, "sellerTrn").message);
ok("no customer is caught", !!at({ ...good, partyName: "" }, "partyId"));
ok("no lines at all is caught", !!at({ ...good, lines: [] }, "lines"));
ok("a line with no description is caught", !!at({ ...good, lines: [line({ description: " " })] }, "lines.0.description"));
ok("a zero quantity is caught", !!at({ ...good, lines: [line({ quantity: 0 })] }, "lines.0.quantity"));
ok("an unknown unit of measure is caught", !!at({ ...good, lines: [line({ unitCode: "ZZZ" })] }, "lines.0.unitCode"));
ok("a negative price is caught", !!at({ ...good, lines: [line({ unitPrice: -1 })] }, "lines.0.unitPrice"));
ok("and is told to raise a credit note instead",
  /credit note/.test(at({ ...good, lines: [line({ unitPrice: -1 })] }, "lines.0.unitPrice").message));
ok("a line with no account is caught", !!at({ ...good, lines: [line({ accountId: undefined })] }, "lines.0.accountId"));
ok("a discount larger than the line is caught",
  !!at({ ...good, lines: [line({ unitPrice: 100, discount: 500 })] }, "lines.0.discount"));
ok("problems name the line they are on", /line 1/.test(at({ ...good, lines: [line({ description: "" })] }, "lines.0.description").message));

// The buyer's TRN is what lets them recover the tax.
ok("a standard-rated sale with no customer TRN is caught",
  !!at({ ...good, partyTrn: null }, "partyTrn"));
ok("but a zero-rated sale does not need one",
  !at({ ...good, partyTrn: null, lines: [line({ vatTreatment: "Zero-rated" })] }, "partyTrn"),
  "an export to an unregistered buyer is perfectly ordinary");

// A supplier's bill carries the supplier's number, which is theirs to get right.
ok("a purchase does not demand our TRN on the face of it",
  !at({ ...good, side: "Purchase", sellerTrn: null }, "sellerTrn"));
ok("nor the counterparty's", !at({ ...good, side: "Purchase", partyTrn: null }, "partyTrn"));

// A note that does not say what it adjusts is unattributable.
for (const docType of ["Credit Note", "Debit Note"]) {
  ok(`a ${docType.toLowerCase()} must name the invoice it adjusts`,
    !!at({ ...good, docType, originalInvoiceNumber: null }, "originalInvoiceNumber"));
  ok(`and passes once it does`,
    !at({ ...good, docType, originalInvoiceNumber: "WBE/INV/00001" }, "originalInvoiceNumber"));
}
ok("an ordinary invoice does not need one", !at(good, "originalInvoiceNumber"));

{
  const many = checkInvoice({ ...good, issueDate: null, sellerTrn: null, partyName: "", lines: [] });
  ok("everything wrong is reported at once, not one at a time", many.length >= 4, `${many.length} problems`);
}

/* ===================== terms =========================================== */
{
  const issued = new Date("2026-09-01T00:00:00Z");
  ok("the due date comes from the party's terms",
    dueDateFrom(issued, 30).toISOString().slice(0, 10) === "2026-10-01");
  ok("nil terms means due on issue", dueDateFrom(issued, 0).getTime() === issued.getTime());
  ok("negative terms cannot make it due before it was raised",
    dueDateFrom(issued, -10).getTime() === issued.getTime());
}

ok("the three document types are the ones the law recognises",
  DOC_TYPES.join(",") === "Invoice,Credit Note,Debit Note");
ok("a document is draft, issued or cancelled",
  INVOICE_STATUSES.join(",") === "Draft,Issued,Cancelled");
ok("and is ours or theirs", INVOICE_SIDES.join(",") === "Sales,Purchase");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
