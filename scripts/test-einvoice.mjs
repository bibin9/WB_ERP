/**
 * The electronic invoice document.
 *
 * Nothing here reaches a tax authority; an accredited service provider does
 * that. What this file holds is the document that provider will validate, and
 * the things a validator refuses:
 *
 *   - a credit note is a different root element, not an invoice with a minus;
 *   - a nil rate must say why it is nil;
 *   - the tax groups must add to the header, and the lines to the net;
 *   - an ampersand in a customer's name must not break the parser.
 *
 * A rejection under the five-corner model comes back hours later from somebody
 * else's system, long after the customer has the invoice. Every one of these is
 * cheaper to catch here.
 */
import { importLibs } from "./lib-shim.mjs";

const { einvoice } = await importLibs(["einvoice"]);
const {
  DOCUMENT_TYPE_CODE, TAX_CATEGORY_CODE, EXEMPTION_REASON, DEFAULT_EINVOICE_SETTINGS,
  xmlEscape, buildUbl, checkTransmittable,
} = einvoice;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const d = (s) => new Date(`${s}T00:00:00.000Z`);

const SETTINGS = { customizationId: "urn:example:pint:ae:1.0", profileId: "urn:example:bis:billing:3.0" };

const line = (o = {}) => ({
  description: "Cable tray installation", quantity: 120, unitCode: "MTR",
  unitPrice: 45, discount: 0, netAmount: 5400,
  vatTreatment: "Standard", vatRate: 5, vatAmount: 270, ...o,
});

const doc = (o = {}) => {
  const lines = o.lines ?? [line()];
  const net = lines.reduce((t, l) => t + l.netAmount, 0);
  const vat = lines.reduce((t, l) => t + l.vatAmount, 0);
  const groups = new Map();
  for (const l of lines) {
    const k = `${l.vatTreatment}|${l.vatRate}`;
    const g = groups.get(k) ?? { treatment: l.vatTreatment, ratePercent: l.vatRate, taxable: 0, tax: 0 };
    g.taxable += l.netAmount; g.tax += l.vatAmount;
    groups.set(k, g);
  }
  return {
    number: "WBE/INV/00001", docType: "Invoice",
    issueDate: d("2026-06-20"), dueDate: d("2026-07-20"), currency: "AED",
    seller: { name: "WB Engineering LLC", trn: "100123456700003", addressLine: "Plot 42, Industrial Area 3", city: "Sharjah", emirate: "Sharjah", countryCode: "AE" },
    buyer: { name: "Al Habtoor LLC", trn: "100987654300003", addressLine: "Dubai", countryCode: "AE" },
    lines, netTotal: net, vatTotal: vat, grossTotal: net + vat,
    taxBreakdown: [...groups.values()],
    ...o,
  };
};

/* ===================== codes fixed by the specification ================= */

ok("a commercial invoice is 380", DOCUMENT_TYPE_CODE["Invoice"] === "380");
ok("a credit note is 381", DOCUMENT_TYPE_CODE["Credit Note"] === "381");
ok("a debit note is 383", DOCUMENT_TYPE_CODE["Debit Note"] === "383");
ok("standard rated is category S", TAX_CATEGORY_CODE["Standard"] === "S");
ok("zero rated is Z, exempt is E, out of scope is O",
  TAX_CATEGORY_CODE["Zero-rated"] === "Z" && TAX_CATEGORY_CODE["Exempt"] === "E" && TAX_CATEGORY_CODE["Out of scope"] === "O");
ok("reverse charge is AE", TAX_CATEGORY_CODE["Reverse charge"] === "AE");
ok("every treatment that bears no tax has a reason ready",
  ["Zero-rated", "Exempt", "Out of scope", "Reverse charge"].every((t) => !!EXEMPTION_REASON[t]));
ok("the identifiers are blank until a provider supplies them",
  DEFAULT_EINVOICE_SETTINGS.customizationId === "" && DEFAULT_EINVOICE_SETTINGS.profileId === "",
  "guessing them would be rejected for a reason nobody could see");

/* ===================== escaping ========================================= */

ok("an ampersand is escaped", xmlEscape("Smith & Sons") === "Smith &amp; Sons");
ok("angle brackets are escaped", xmlEscape("<b>") === "&lt;b&gt;");
ok("quotes are escaped", xmlEscape(`He said "no" and 'left'`).includes("&quot;") === true);
ok("a control character is removed rather than escaped",
  !/[\x00-\x08]/.test(xmlEscape("bad\x07value")), "invalid in XML 1.0 either way");
ok("ordinary text is untouched", xmlEscape("Cable tray 120m") === "Cable tray 120m");
{
  // A customer really is called this sort of thing, and an unescaped ampersand
  // does not make a wrong document — it makes an unparseable one.
  const xml = buildUbl(doc({ buyer: { name: "Smith & Sons <Contracting>", trn: "100000000000003", countryCode: "AE" } }), SETTINGS);
  ok("a name with an ampersand survives into the document", xml.includes("Smith &amp; Sons &lt;Contracting&gt;"));
  ok("and no raw ampersand is left anywhere", !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
}

/* ===================== the invoice document ============================= */
{
  const xml = buildUbl(doc(), SETTINGS);
  ok("it declares itself XML", xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  ok("the root is an Invoice", /<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/.test(xml));
  ok("the cac and cbc namespaces are declared", xml.includes("CommonAggregateComponents-2") && xml.includes("CommonBasicComponents-2"));
  ok("the customisation and profile the provider gave us are on it",
    xml.includes("<cbc:CustomizationID>urn:example:pint:ae:1.0</cbc:CustomizationID>") &&
    xml.includes("<cbc:ProfileID>urn:example:bis:billing:3.0</cbc:ProfileID>"));
  ok("the number and dates are there",
    xml.includes("<cbc:ID>WBE/INV/00001</cbc:ID>") &&
    xml.includes("<cbc:IssueDate>2026-06-20</cbc:IssueDate>") &&
    xml.includes("<cbc:DueDate>2026-07-20</cbc:DueDate>"));
  ok("it carries the invoice type code", xml.includes("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>"));
  ok("and the currency", xml.includes("<cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>"));

  ok("both TRNs are on it under a VAT scheme",
    (xml.match(/<cbc:CompanyID>1001234567\d+<\/cbc:CompanyID>/) ?? []).length === 1 &&
    xml.includes("<cbc:CompanyID>100987654300003</cbc:CompanyID>"));
  ok("the seller and the buyer are distinguished",
    xml.includes("<cac:AccountingSupplierParty>") && xml.includes("<cac:AccountingCustomerParty>"));
  ok("the emirate travels as the country subdivision, which PINT AE wants separately",
    xml.includes("<cbc:CountrySubentity>Sharjah</cbc:CountrySubentity>"));
  ok("and the country code", xml.includes("<cbc:IdentificationCode>AE</cbc:IdentificationCode>"));

  ok("amounts carry the currency as an attribute",
    xml.includes('<cbc:TaxAmount currencyID="AED">270.00</cbc:TaxAmount>'));
  ok("amounts are fixed to two decimals, because 5 and 5.00 are different fields",
    xml.includes(">5400.00<") && !/>5400</.test(xml));
  ok("the four monetary totals are all present",
    ["LineExtensionAmount", "TaxExclusiveAmount", "TaxInclusiveAmount", "PayableAmount"]
      .every((t) => xml.includes(`<cbc:${t} currencyID="AED">`)));
  ok("the payable is net plus tax", xml.includes('<cbc:PayableAmount currencyID="AED">5670.00</cbc:PayableAmount>'));

  ok("the line carries quantity with its unit code",
    xml.includes('<cbc:InvoicedQuantity unitCode="MTR">120</cbc:InvoicedQuantity>'));
  ok("and a description, a price and a tax category",
    xml.includes("<cbc:Name>Cable tray installation</cbc:Name>") &&
    xml.includes('<cbc:PriceAmount currencyID="AED">45.00</cbc:PriceAmount>') &&
    xml.includes("<cac:ClassifiedTaxCategory>"));
  ok("every element that opens is closed",
    (xml.match(/<cac:/g) ?? []).length === (xml.match(/<\/cac:/g) ?? []).length * 2 - (xml.match(/<\/cac:/g) ?? []).length,
    "same number of opening and closing cac elements");
}

/* ===================== a credit note is a different document ============ */
{
  const xml = buildUbl(doc({
    docType: "Credit Note", number: "WBE/CN/00001",
    precedingNumber: "WBE/INV/00001", precedingDate: d("2026-06-20"),
  }), SETTINGS);

  // Not an invoice with a minus sign. A different root, a different line
  // element and a different quantity element — a document that got this wrong
  // would parse and mean something else.
  ok("the root is a CreditNote", /<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/.test(xml));
  ok("its lines are CreditNoteLine", xml.includes("<cac:CreditNoteLine>") && !xml.includes("<cac:InvoiceLine>"));
  ok("and the quantity is a credited quantity", xml.includes("<cbc:CreditedQuantity"));
  ok("it carries type code 381", xml.includes("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>"));
  ok("it names the invoice it adjusts",
    xml.includes("<cac:BillingReference>") && xml.includes("<cbc:ID>WBE/INV/00001</cbc:ID>"));
  ok("with that invoice's date", xml.includes("<cbc:IssueDate>2026-06-20</cbc:IssueDate>"));
  ok("a credit note has no due date, because nothing falls due on it", !xml.includes("<cbc:DueDate>"));
}
{
  const xml = buildUbl(doc({ docType: "Debit Note", precedingNumber: "WBE/INV/00001" }), SETTINGS);
  ok("a debit note travels as an invoice document",
    xml.includes("<Invoice ") && xml.includes("<cbc:InvoiceTypeCode>383</cbc:InvoiceTypeCode>"),
    "only a credit note has a root of its own in UBL");
}

/* ===================== rates and reasons ================================ */
{
  const xml = buildUbl(doc({
    lines: [
      line({ netAmount: 1000, vatAmount: 50 }),
      line({ description: "Export", vatTreatment: "Zero-rated", vatRate: 0, netAmount: 2000, vatAmount: 0 }),
      line({ description: "Bare land", vatTreatment: "Exempt", vatRate: 0, netAmount: 500, vatAmount: 0 }),
    ],
  }), SETTINGS);

  ok("one tax subtotal per category", (xml.match(/<cac:TaxSubtotal>/g) ?? []).length === 3);
  ok("the zero-rated group says why it is nil",
    xml.includes("<cbc:TaxExemptionReason>Zero-rated supply</cbc:TaxExemptionReason>"),
    "a nil rate without a reason is refused");
  ok("and so does the exempt group", xml.includes("<cbc:TaxExemptionReason>Exempt supply</cbc:TaxExemptionReason>"));
  ok("the standard group does not carry a reason, because it is not exempt",
    (xml.match(/<cbc:TaxExemptionReason>/g) ?? []).length === 2);
  ok("each line names its own category",
    (xml.match(/<cac:ClassifiedTaxCategory>/g) ?? []).length === 3);
  ok("the header tax equals the groups", xml.includes('<cbc:TaxAmount currencyID="AED">50.00</cbc:TaxAmount>'));
}
{
  const xml = buildUbl(doc({ lines: [line({ discount: 400, netAmount: 5000 })] }), SETTINGS);
  ok("a discount travels as an allowance, not a lower price",
    xml.includes("<cac:AllowanceCharge>") && xml.includes("<cbc:ChargeIndicator>false</cbc:ChargeIndicator>"),
    "the customer must be able to see what the discount was");
  ok("and the price stays what was quoted", xml.includes('<cbc:PriceAmount currencyID="AED">45.00</cbc:PriceAmount>'));
}

/* ===================== what a validator would refuse ==================== */

ok("a complete document has nothing to fix", checkTransmittable(doc(), SETTINGS).length === 0,
  checkTransmittable(doc(), SETTINGS).map((p) => p.message).join(" | "));

const at = (o, settings, field) => checkTransmittable(doc(o), settings ?? SETTINGS).find((p) => p.field === field);

ok("no identifiers means nothing may be sent", !!at({}, { customizationId: "", profileId: "" }, "settings"));
ok("and the message says where to get them",
  /accredited service provider/.test(at({}, { customizationId: "", profileId: "" }, "settings").message));
ok("our own TRN missing is caught",
  !!at({ seller: { name: "X", trn: null, emirate: "Dubai" } }, null, "seller.trn"));
ok("our emirate missing is caught",
  !!at({ seller: { name: "X", trn: "100000000000003", emirate: null } }, null, "seller.emirate"));
ok("no customer name is caught", !!at({ buyer: { name: "", trn: null } }, null, "buyer.name"));
ok("no lines is caught", !!at({ lines: [], netTotal: 0, vatTotal: 0, grossTotal: 0, taxBreakdown: [] }, null, "lines"));
ok("a note that names no invoice is caught",
  !!at({ docType: "Credit Note", precedingNumber: null }, null, "precedingNumber"));

// The arithmetic a validator re-does on arrival. If it disagrees, the message
// from a foreign system will not say which of the three numbers was wrong.
ok("lines that do not add to the net are caught",
  !!at({ netTotal: 9999 }, null, "netTotal"));
ok("and the problem says both figures",
  /5400/.test(at({ netTotal: 9999 }, null, "netTotal").message) && /9999/.test(at({ netTotal: 9999 }, null, "netTotal").message));
ok("tax groups that do not add to the header are caught", !!at({ vatTotal: 999 }, null, "vatTotal"));
ok("a total that is not net plus tax is caught", !!at({ grossTotal: 1 }, null, "grossTotal"));
{
  const bad = checkTransmittable(
    doc({ lines: [line({ vatTreatment: "Odd", vatRate: 0, vatAmount: 0 })] }),
    SETTINGS,
  );
  ok("a nil-rated group with no reason available is caught",
    bad.some((p) => p.field === "taxBreakdown"), bad.map((p) => p.message).join(" | "));
}
{
  const many = checkTransmittable(
    doc({ seller: { name: "X", trn: null, emirate: null }, buyer: { name: "" }, netTotal: 1 }),
    { customizationId: "", profileId: "" },
  );
  ok("everything wrong is reported at once", many.length >= 5, `${many.length} problems`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
