/**
 * The tax invoice, credit note or debit note, as the customer receives it.
 *
 * Everything comes from what was snapshotted at issue — customer name, address
 * and TRN, our TRN and address — not from the master records as they stand
 * today. A reprint of a document already sent must be the same document.
 *
 * Sales only. A supplier's bill is their document, not ours: printing it on
 * our letterhead under TAX INVOICE would manufacture an invoice we never
 * issued. Anything not issued says so across every page.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { amountInWords } from "@/lib/amount-words";
import { unitLabel } from "@/lib/invoice";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TotalsBox, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Line = {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  net: number;
  treatment: string;
  rate: number;
  vat: number;
};

type TaxGroup = { treatment: string; ratePercent: number; taxable: number; tax: number };

export type TaxInvoiceDoc = {
  filename: string;
  lh: Letterhead;
  docType: string;
  status: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  sellerTrn: string | null;
  sellerAddress: string | null;
  customer: (string | null | undefined)[];
  customerTrn: string | null;
  job: string | null;
  against: { number: string; issueDate: Date } | null;
  currency: string;
  lines: Line[];
  breakdown: TaxGroup[];
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  notes: string | null;
  issuedBy: string | null;
};

/** The title the law expects on the face of the document. */
export const invoiceTitle = (docType: string) => (docType === "Invoice" ? "TAX INVOICE" : docType.toUpperCase());

/** Only an issued document prints clean. */
export const invoiceWatermark = (status: string): string | null =>
  status === "Issued" ? null : status === "Cancelled" ? "CANCELLED" : "DRAFT";

export async function loadTaxInvoice(id: string, companyIds: string[]): Promise<TaxInvoiceDoc | null> {
  const inv = await db.invoice.findFirst({
    where: { id, side: "Sales", companyId: { in: companyIds } },
    include: {
      company: { include: { documentSettings: true } },
      lines: { orderBy: { order: "asc" } },
      job: { select: { code: true, name: true } },
      originalInvoice: { select: { number: true, issueDate: true } },
    },
  });
  if (!inv) return null;

  let breakdown: TaxGroup[] = [];
  try {
    breakdown = JSON.parse(inv.taxBreakdown || "[]");
  } catch {
    breakdown = [];
  }

  const lh = letterheadFor(inv.company, inv.company.documentSettings);
  // The TRN printed is the one on the invoice when it was issued, not today's.
  const issuedLh: Letterhead = { ...lh, trn: inv.sellerTrn ? `TRN ${inv.sellerTrn}` : lh.trn };

  return {
    filename: `${inv.number.replace(/[^\w-]+/g, "-")}.pdf`,
    lh: issuedLh,
    docType: inv.docType,
    status: inv.status,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    sellerTrn: inv.sellerTrn,
    sellerAddress: inv.sellerAddress,
    customer: [inv.partyName, inv.partyAddress],
    customerTrn: inv.partyTrn,
    job: inv.job ? `${inv.job.code} — ${inv.job.name}` : null,
    against: inv.originalInvoice,
    currency: inv.currency,
    lines: inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: unitLabel(l.unitCode),
      unitPrice: l.unitPrice,
      discount: l.discount,
      net: l.netAmount,
      treatment: l.vatTreatment,
      rate: l.vatRate,
      vat: l.vatAmount,
    })),
    breakdown,
    netTotal: inv.netTotal,
    vatTotal: inv.vatTotal,
    grossTotal: inv.grossTotal,
    notes: inv.notes,
    issuedBy: inv.issuedBy,
  };
}

export function TaxInvoicePdf(d: TaxInvoiceDoc) {
  const cur = d.currency || "AED";
  const discounted = d.lines.some((l) => l.discount);
  const columns: Column<Line>[] = [
    { label: "#", flex: 0.35, value: (_, i) => String(i + 1) },
    { label: "Description", flex: 3.3, value: (l) => l.description },
    { label: "Qty", flex: 0.7, align: "right", value: (l) => quantity(l.quantity) },
    { label: "Unit", flex: 0.8, value: (l) => l.unit },
    { label: "Rate", flex: 1.1, align: "right", value: (l) => money(l.unitPrice) },
    ...(discounted ? [{ label: "Discount", flex: 1, align: "right" as const, value: (l: Line) => (l.discount ? money(l.discount) : "") }] : []),
    { label: `Net (${cur})`, flex: 1.2, align: "right", value: (l) => money(l.net) },
    { label: "VAT", flex: 0.7, align: "right", value: (l) => (l.treatment === "Standard" ? `${quantity(l.rate)}%` : l.treatment) },
    { label: `VAT (${cur})`, flex: 1, align: "right", value: (l) => money(l.vat) },
  ];

  const totals: [string, string, boolean?][] = [["Total excluding VAT", money(d.netTotal)]];
  for (const g of d.breakdown) {
    totals.push([`VAT ${g.treatment}${g.ratePercent ? ` at ${quantity(g.ratePercent)}%` : ""} on ${money(g.taxable)}`, money(g.tax)]);
  }
  if (!d.breakdown.length) totals.push(["VAT", money(d.vatTotal)]);
  totals.push([`Total including VAT (${cur})`, money(d.grossTotal), true]);

  const title = invoiceTitle(d.docType);
  const reverseCharge = d.lines.some((l) => l.treatment === "Reverse charge");

  return (
    <DocumentFile lh={d.lh} title={`${title} ${d.number}`} watermark={invoiceWatermark(d.status)}>
      <TitleBlock
        lh={d.lh}
        title={title}
        subtitle={d.status === "Issued" ? null : `${d.status} — not a valid ${title.toLowerCase()}`}
        meta={[
          [d.docType === "Invoice" ? "Invoice no." : "Note no.", d.number],
          ["Date of issue", date(d.issueDate)],
          ["Due", d.dueDate ? date(d.dueDate) : ""],
          ["Job", d.job ?? ""],
        ]}
      />

      <PartyRow>
        <PartyBox label="Bill to" lines={[...d.customer, `TRN ${d.customerTrn ?? "—"}`]} />
        {d.against ? (
          <PartyBox label={`Adjusts invoice`} lines={[d.against.number, `dated ${date(d.against.issueDate)}`]} />
        ) : (
          <PartyBox label="Supplier" lines={[d.lh.companyName, d.sellerAddress ?? d.lh.addressLine, d.sellerTrn ? `TRN ${d.sellerTrn}` : null]} />
        )}
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} />

      <TotalsBox lh={d.lh} rows={totals} words={cur === "AED" ? amountInWords(d.grossTotal) : null} />

      {reverseCharge ? (
        <SmallPrint>Reverse charge applies: the recipient accounts for the VAT on the lines marked Reverse charge.</SmallPrint>
      ) : null}

      <TextSection heading="Notes" text={d.notes} />

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: `For ${d.lh.companyName}`, name: d.issuedBy, note: "Authorised signatory" },
            { label: "Received by the customer", note: "Name, signature, date and company stamp" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
