import { toFils } from "./money";
import { type VatTreatment } from "./vat";

/**
 * The tax invoice: what was sold, in what quantity, at what price, and the tax
 * on it broken down by category.
 *
 * Until now this system posted vouchers. A voucher says "debit receivables,
 * credit revenue, VAT 500" — which is enough to keep books and not enough to be
 * a tax invoice. A tax invoice is a commercial document with lines, and the
 * VAT 201 is legally built from those documents rather than inferred from the
 * account movements they caused.
 *
 * It is also what UAE eInvoicing needs. The five-corner model expects a PINT AE
 * document — description, quantity, unit of measure, unit price and a VAT
 * category on every line, plus a breakdown of tax by category on the header.
 * None of that can be reconstructed from a journal entry, at any price, by any
 * service provider.
 *
 * The arithmetic lives here, apart from the database, because it is the part
 * that must be right.
 */

/**
 * Units of measure, as UN/ECE Recommendation 20 codes.
 *
 * The code is what goes on the wire; the label is what a person picks. A
 * contractor bills in most of these in a week, and "each" covers the rest.
 */
export const UNIT_CODES = [
  { code: "EA", label: "Each" },
  { code: "HUR", label: "Hour" },
  { code: "DAY", label: "Day" },
  { code: "MON", label: "Month" },
  { code: "MTR", label: "Metre" },
  { code: "MTK", label: "Square metre" },
  { code: "MTQ", label: "Cubic metre" },
  { code: "KGM", label: "Kilogram" },
  { code: "TNE", label: "Tonne" },
  { code: "LTR", label: "Litre" },
  { code: "SET", label: "Set" },
  { code: "LS", label: "Lump sum" },
] as const;

export const DEFAULT_UNIT_CODE = "EA";
export const unitLabel = (code: string) =>
  UNIT_CODES.find((u) => u.code === code)?.label ?? code;

/** What the document is. A note adjusts an invoice already issued. */
export const DOC_TYPES = ["Invoice", "Credit Note", "Debit Note"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Draft may be edited. Issued is a legal document. Cancelled was never used. */
export const INVOICE_STATUSES = ["Draft", "Issued", "Cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Whether the document is a sale or a purchase.
 *
 * The same shape serves both: a supplier's bill is an invoice somebody else
 * issued, and it needs the same lines to support an input-tax claim.
 */
export const INVOICE_SIDES = ["Sales", "Purchase"] as const;
export type InvoiceSide = (typeof INVOICE_SIDES)[number];

/**
 * The VAT category letter each treatment maps to.
 *
 * These are the standard UNCL5305 codes a Peppol document carries, and they are
 * fixed by the specification rather than chosen by us.
 */
export const VAT_CATEGORY_CODE: Record<VatTreatment, string> = {
  Standard: "S",
  "Zero-rated": "Z",
  Exempt: "E",
  "Out of scope": "O",
  "Reverse charge": "AE",
};

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  /** A cash discount on the line, in currency, not a percentage. */
  discount?: number;
  vatTreatment: VatTreatment;
  /** The account the line bills to — revenue for a sale, a cost for a purchase. */
  accountId?: string;
  jobId?: string | null;
  costCentreId?: string | null;
};

export type LineTotals = { net: number; vatRate: number; vat: number; gross: number };

/**
 * What one line comes to.
 *
 * Every figure is put through toFils() rather than left as raw arithmetic:
 * 3 × 373.33 is 1,119.99 and a VAT extraction gives 55.9995, and the difference
 * between rounding here and rounding on the screen is a return that disagrees
 * with itself. Only Standard is rated; every other treatment is zero tax, and
 * reverse charge is zero on the invoice by definition — the buyer accounts
 * for it.
 */
export function lineTotals(line: InvoiceLineInput, standardRate: number): LineTotals {
  const gross = toFils(Math.max(0, line.quantity) * line.unitPrice);
  const net = toFils(gross - toFils(line.discount ?? 0));
  const vatRate = line.vatTreatment === "Standard" ? standardRate : 0;
  const vat = toFils(net * vatRate);
  return { net, vatRate: toFils(vatRate * 100), vat, gross: toFils(net + vat) };
}

export type TaxBreakdownRow = {
  treatment: VatTreatment;
  /** The UNCL5305 letter the document carries. */
  categoryCode: string;
  ratePercent: number;
  taxable: number;
  tax: number;
};

export type InvoiceTotals = {
  net: number;
  vat: number;
  gross: number;
  /** Tax grouped by category — a mandatory part of the document, not a nicety. */
  breakdown: TaxBreakdownRow[];
  lines: LineTotals[];
};

/**
 * The document totals, and the tax broken down by category.
 *
 * The breakdown is not decoration. A PINT AE document must carry one group per
 * VAT category with its taxable amount and its tax, and the sum of those groups
 * must equal the header tax — a validator rejects the document otherwise. It is
 * also what makes a return provable: box by box, back to the invoices.
 */
export function invoiceTotals(lines: InvoiceLineInput[], standardRate: number): InvoiceTotals {
  const computed = lines.map((l) => lineTotals(l, standardRate));

  const groups = new Map<string, TaxBreakdownRow>();
  lines.forEach((l, i) => {
    const t = computed[i];
    const key = `${l.vatTreatment}|${t.vatRate}`;
    const row = groups.get(key) ?? {
      treatment: l.vatTreatment,
      categoryCode: VAT_CATEGORY_CODE[l.vatTreatment],
      ratePercent: t.vatRate,
      taxable: 0,
      tax: 0,
    };
    row.taxable = toFils(row.taxable + t.net);
    row.tax = toFils(row.tax + t.vat);
    groups.set(key, row);
  });

  const breakdown = [...groups.values()].sort((a, b) => b.taxable - a.taxable);
  const net = computed.reduce((t, l) => toFils(t + l.net), 0);
  const vat = computed.reduce((t, l) => toFils(t + l.vat), 0);

  return { net, vat, gross: toFils(net + vat), breakdown, lines: computed };
}

/* ========================= is it fit to issue? =========================== */

export type InvoiceProblem = { field: string; message: string };

export type InvoiceCheckInput = {
  side: InvoiceSide;
  docType: DocType;
  issueDate: Date | null;
  /** Our own TRN, which every tax invoice must carry. */
  sellerTrn: string | null;
  partyName: string | null;
  partyTrn: string | null;
  lines: InvoiceLineInput[];
  /** Set on a credit or debit note: the invoice it adjusts. */
  originalInvoiceNumber?: string | null;
};

/**
 * Everything that would make the document invalid, in one pass.
 *
 * Deliberately checked before issue rather than at the point of transmission.
 * Under the five-corner model a rejection can come back hours later from the
 * buyer's service provider, by which time the accountant has moved on and the
 * customer is waiting; a document that cannot pass should never leave Draft.
 *
 * The messages name what to do, not what is wrong with the data, because the
 * person reading them is usually not the person who typed it.
 */
export function checkInvoice(input: InvoiceCheckInput): InvoiceProblem[] {
  const problems: InvoiceProblem[] = [];

  if (!input.issueDate) {
    problems.push({ field: "issueDate", message: "Give the invoice a date." });
  }

  // Only our own supplies need our TRN on the face of the document. On a
  // supplier's bill it is the supplier's number that matters, which is theirs
  // to get right, not ours.
  if (input.side === "Sales" && !input.sellerTrn) {
    problems.push({
      field: "sellerTrn",
      message: "Your own VAT registration number is missing. Add it on Companies → edit the company — a tax invoice is not valid without it.",
    });
  }

  if (!input.partyName?.trim()) {
    problems.push({ field: "partyId", message: "Choose the customer or supplier this is for." });
  }

  if (input.lines.length === 0) {
    problems.push({ field: "lines", message: "Add at least one line." });
  }

  input.lines.forEach((l, i) => {
    const at = `line ${i + 1}`;
    if (!l.description?.trim()) {
      problems.push({ field: `lines.${i}.description`, message: `Describe what is being billed on ${at}.` });
    }
    if (!(l.quantity > 0)) {
      problems.push({ field: `lines.${i}.quantity`, message: `Quantity on ${at} must be more than nothing.` });
    }
    if (!UNIT_CODES.some((u) => u.code === l.unitCode)) {
      problems.push({ field: `lines.${i}.unitCode`, message: `Choose a unit of measure on ${at}.` });
    }
    if (l.unitPrice < 0) {
      problems.push({ field: `lines.${i}.unitPrice`, message: `A negative price on ${at} — raise a credit note instead.` });
    }
    if (!l.accountId) {
      problems.push({ field: `lines.${i}.accountId`, message: `Say which account ${at} belongs to.` });
    }
    if ((l.discount ?? 0) > toFils(l.quantity * l.unitPrice)) {
      problems.push({ field: `lines.${i}.discount`, message: `The discount on ${at} is more than the line itself.` });
    }
  });

  // Standard-rated business-to-business supply: the buyer's TRN is what lets
  // them recover the tax. Without it the invoice is not much use to them and
  // an inspection will ask why it is missing.
  const standardRated = input.lines.some((l) => l.vatTreatment === "Standard");
  if (input.side === "Sales" && standardRated && !input.partyTrn) {
    problems.push({
      field: "partyTrn",
      message: "This customer has no TRN on file. A standard-rated invoice to a registered business needs one — add it on Finance → Registers → Parties, or confirm they are not registered.",
    });
  }

  // A note that does not say what it adjusts is unattributable, and the
  // specification requires the reference.
  if (input.docType !== "Invoice" && !input.originalInvoiceNumber?.trim()) {
    problems.push({
      field: "originalInvoiceNumber",
      message: `Say which invoice this ${input.docType.toLowerCase()} adjusts.`,
    });
  }

  return problems;
}

/** Due date from the party's terms, so it is not typed and cannot drift. */
export function dueDateFrom(issueDate: Date, creditDays: number): Date {
  return new Date(issueDate.getTime() + Math.max(0, creditDays) * 24 * 60 * 60 * 1000);
}
