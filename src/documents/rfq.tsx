/**
 * The enquiry a supplier is asked to price.
 *
 * Addressed to one supplier when printed from their column on the comparison
 * sheet, or left unaddressed for a supplier not yet on file. It carries
 * quantities and nothing else: what another supplier quoted, or what we
 * expect to pay, never leaves the building on this page.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TextSection, Signatures, SmallPrint,
  quantity, date, type Column,
} from "./parts";

type Line = { description: string; unit: string; quantity: number };

export type RfqDoc = {
  filename: string;
  lh: Letterhead;
  number: string;
  status: string;
  date: Date;
  neededBy: Date | null;
  job: string | null;
  supplier: (string | null | undefined)[] | null;
  askedBy: string;
  lines: Line[];
  notes: string | null;
  terms: string | null;
};

/** An enquiry already decided or called off must not be sent out to be priced. */
export const RFQ_WATERMARK: Record<string, string> = {
  Awarded: "CLOSED",
  Cancelled: "CANCELLED",
};

/**
 * `id` is a supplier's place on the enquiry (addressed to them) or the enquiry
 * itself (unaddressed).
 */
export async function loadRfq(id: string, companyIds: string[]): Promise<RfqDoc | null> {
  const include = {
    company: { include: { documentSettings: true } },
    job: { select: { code: true, name: true } },
    lines: { orderBy: { sortOrder: "asc" as const } },
  };
  const quote = await db.rfqQuote.findFirst({
    where: { id, rfq: { companyId: { in: companyIds } } },
    include: { party: true, rfq: { include } },
  });
  const rfq = quote?.rfq ?? (await db.rfq.findFirst({ where: { id, companyId: { in: companyIds } }, include }));
  if (!rfq) return null;

  const p = quote?.party;
  const base = rfq.number.replace(/[^\w-]+/g, "-");
  return {
    filename: p ? `${base}-${p.code.replace(/[^\w-]+/g, "-")}.pdf` : `${base}.pdf`,
    lh: letterheadFor(rfq.company, rfq.company.documentSettings),
    number: rfq.number,
    status: rfq.status,
    date: rfq.date,
    neededBy: rfq.neededBy,
    job: rfq.job ? `${rfq.job.code} — ${rfq.job.name}` : null,
    supplier: p
      ? [
          quote!.partyName,
          p.addressLine ?? p.address,
          [p.city, p.emirate].filter(Boolean).join(", "),
          p.contactPerson ? `Attention: ${p.contactPerson}` : null,
          p.email,
        ]
      : null,
    askedBy: rfq.raisedBy,
    lines: rfq.lines.map((l) => ({ description: l.description, unit: l.unitCode, quantity: l.quantity })),
    notes: rfq.notes,
    terms: rfq.company.documentSettings?.rfqTerms ?? null,
  };
}

const columns: Column<Line>[] = [
  { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
  { label: "Description", flex: 4, value: (l) => l.description },
  { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
  { label: "Unit", flex: 0.8, value: (l) => l.unit },
  { label: "Your unit price", flex: 1.5, align: "right", value: () => "" },
  { label: "Your amount", flex: 1.5, align: "right", value: () => "" },
];

export function RfqPdf(d: RfqDoc) {
  return (
    <DocumentFile lh={d.lh} title={`Request for quotation ${d.number}`} watermark={RFQ_WATERMARK[d.status] ?? null}>
      <TitleBlock
        lh={d.lh}
        title="REQUEST FOR QUOTATION"
        subtitle="Please quote your best price for the items below."
        meta={[
          ["Enquiry no.", d.number],
          ["Date", date(d.date)],
          ["Needed on site", d.neededBy ? date(d.neededBy) : ""],
          ["Job", d.job ?? ""],
        ]}
      />

      <PartyRow>
        <PartyBox label="To" lines={d.supplier ?? []} writeIn={d.supplier ? undefined : 70} />
        <PartyBox label="Please reply to" lines={[d.lh.companyName, d.askedBy, d.lh.contact]} />
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} minRowHeight={24} />

      <PartyRow>
        <PartyBox label="Delivery charge (AED)" lines={[]} writeIn={40} />
        <PartyBox label="Delivery time (days)" lines={[]} writeIn={40} />
        <PartyBox label="Price valid until" lines={[]} writeIn={40} />
      </PartyRow>

      <SmallPrint>
        Quote this enquiry number on your quotation. Prices in UAE Dirhams excluding VAT, delivered to our store unless
        you say otherwise. If you cannot supply an item exactly as described, quote your alternative and say so. This
        enquiry is not an order: nothing should be delivered until a purchase order is received.
      </SmallPrint>

      <TextSection heading="Notes" text={d.notes} />
      <TextSection heading="Terms" text={d.terms} />

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: `For ${d.lh.companyName}`, name: d.askedBy },
            { label: "Supplier", note: "Name, signature, date and company stamp" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
