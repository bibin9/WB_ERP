/**
 * The quotation, as the customer receives it.
 *
 * Every figure comes from what the quotation snapshotted when it was raised,
 * not from the estimate as it stands now — the estimate goes on being edited
 * for the next revision, and a reprint of a document already sent must be the
 * same document.
 *
 * Nothing that has not been approved can pass for the real thing: a draft, or
 * one still waiting on management, prints with DRAFT across every page, and a
 * replaced revision prints SUPERSEDED.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { priceLines, readSnapshot, type QuoteLine } from "@/lib/quotation-lines";
import { priceEstimate, toBidLine } from "@/lib/estimate-posting";
import { bidLine } from "@/lib/estimating";
import { amountInWords } from "@/lib/amount-words";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TotalsBox, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

export type QuotationDoc = {
  filename: string;
  lh: Letterhead;
  number: string;
  revision: number;
  status: string;
  title: string;
  issuedOn: Date;
  validUntil: Date | null;
  enquiry: string | null;
  preparedBy: string;
  approvedBy: string | null;
  customer: (string | null | undefined)[];
  attention: string | null;
  lines: QuoteLine[];
  total: number;
  /** Only on a quotation raised before lines were snapshotted. */
  rounding: number;
  reproduced: boolean;
  terms: string | null;
  replaces: string | null;
  replacedBy: string | null;
};

const WATERMARK: Record<string, string> = {
  Draft: "DRAFT",
  "Awaiting approval": "DRAFT",
  Superseded: "SUPERSEDED",
};

export async function loadQuotation(
  id: string,
  companyIds: string[],
  /**
   * The date to print as the issue date. Sending draws the PDF a moment before
   * the quotation is marked issued, and the copy the customer receives must
   * carry the day it was sent, not the day it was first raised.
   */
  options: { issuedOn?: Date } = {},
): Promise<QuotationDoc | null> {
  const q = await db.quotation.findFirst({
    where: { id, companyId: { in: companyIds } },
    include: {
      company: { include: { documentSettings: true } },
      party: true,
      lead: { select: { number: true, contactName: true } },
      estimate: { include: { lines: { include: { takeoffs: true }, orderBy: { sortOrder: "asc" } } } },
      supersedes: { select: { number: true, revision: true } },
      supersededBy: { select: { number: true, revision: true } },
    },
  });
  if (!q) return null;

  let lines = readSnapshot(q.linesSnapshot);
  let rounding = 0;
  let reproduced = false;

  // A quotation raised before snapshots existed. Its lines are reproduced from
  // the estimate, and any difference from the total it was issued at is shown
  // as a line of its own — the figure the customer was given is never changed
  // to make the arithmetic tidy.
  if (!lines && q.estimate) {
    const totals = priceEstimate(q.estimate);
    const priced = priceLines(
      q.estimate.lines.map((l) => {
        const b = bidLine(toBidLine(l));
        return { ref: l.ref, description: l.description, unit: l.unit, quantity: b.quantity, unitCost: b.unitCost };
      }),
      totals.direct,
      totals.sell,
    );
    lines = priced.lines;
    rounding = Math.round((q.total - priced.total) * 100) / 100;
    reproduced = true;
  }

  const p = q.party;
  return {
    filename: `${q.number.replace(/[^\w-]+/g, "-")}${q.revision > 1 ? `-rev${q.revision}` : ""}.pdf`,
    lh: letterheadFor(q.company, q.company.documentSettings),
    number: q.number,
    revision: q.revision,
    status: q.status,
    title: q.title,
    issuedOn: options.issuedOn ?? q.issuedAt ?? q.createdAt,
    validUntil: q.validUntil,
    enquiry: q.lead?.number ?? null,
    preparedBy: q.preparedBy,
    approvedBy: q.approvedBy,
    customer: [
      q.customerName,
      p?.addressLine ?? p?.address,
      [p?.city, p?.emirate].filter(Boolean).join(", "),
      p?.trn ? `TRN ${p.trn}` : null,
    ],
    attention: q.lead?.contactName ?? p?.contactPerson ?? null,
    lines: lines ?? [],
    total: q.total,
    rounding,
    reproduced,
    terms: q.terms ?? q.company.documentSettings?.quotationTerms ?? null,
    replaces: q.supersedes ? `${q.supersedes.number} (revision ${q.supersedes.revision})` : null,
    replacedBy: q.supersededBy ? `${q.supersededBy.number} (revision ${q.supersededBy.revision})` : null,
  };
}

const columns: Column<QuoteLine>[] = [
  { label: "Ref", flex: 0.6, value: (l, i) => l.ref || String(i + 1) },
  { label: "Description", flex: 3.7, value: (l) => l.description },
  { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
  { label: "Unit", flex: 1.4, value: (l) => l.unit },
  { label: "Rate (AED)", flex: 1.3, align: "right", value: (l) => money(l.rate) },
  { label: "Amount (AED)", flex: 1.5, align: "right", value: (l) => money(l.amount) },
];

export function QuotationPdf(d: QuotationDoc) {
  const totals: [string, string, boolean?][] = [];
  if (d.rounding !== 0) {
    totals.push(["Lines", money(d.total - d.rounding)]);
    totals.push(["Rounding", money(d.rounding)]);
  }
  totals.push(["Total, excluding VAT (AED)", money(d.total), true]);

  return (
    <DocumentFile lh={d.lh} title={`Quotation ${d.number}`} watermark={WATERMARK[d.status] ?? null}>
      <TitleBlock
        lh={d.lh}
        title={d.revision > 1 ? `QUOTATION — REVISION ${d.revision}` : "QUOTATION"}
        subtitle={d.title}
        meta={[
          ["Quotation no.", d.number],
          ["Date", date(d.issuedOn)],
          ["Valid until", d.validUntil ? date(d.validUntil) : ""],
          ["Your enquiry", d.enquiry ?? ""],
          ["Replaces", d.replaces ?? ""],
        ]}
      />

      <PartyRow>
        <PartyBox label="To" lines={d.customer} />
        <PartyBox label="Attention" lines={[d.attention, d.replacedBy ? `Replaced by ${d.replacedBy}` : null]} />
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} />

      <TotalsBox lh={d.lh} rows={totals} words={amountInWords(d.total)} />

      <SmallPrint>
        VAT at the standard rate will be added on the tax invoice where it applies. Rates are unit rates for the
        quantities shown and will be used to value any variation.
      </SmallPrint>

      <TextSection heading="Terms and conditions" text={d.terms} />

      {d.reproduced ? (
        <SmallPrint>
          This copy was reproduced from the estimate behind the quotation, which was raised before line detail was
          kept with it. The total is the one the quotation was issued at.
        </SmallPrint>
      ) : null}

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: `For ${d.lh.companyName} — prepared by`, name: d.preparedBy },
            { label: "Approved by", name: d.approvedBy },
            { label: "Accepted by the customer", note: "Name, signature, date and company stamp" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
