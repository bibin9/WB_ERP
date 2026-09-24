/**
 * The purchase order, as the supplier receives it.
 *
 * Prices and lines are the order's own, never re-read from the item master: a
 * standard cost changed next month must not change an order already placed.
 *
 * Only an approved order is a commitment. Anything short of that prints with
 * its state across every page — a supplier who delivers against a draft has
 * been given a document that looked like an order.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { amountInWords } from "@/lib/amount-words";
import { isServiceOrder } from "@/lib/purchasing";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TotalsBox, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Line = { description: string; unit: string; quantity: number; unitPrice: number; amount: number; job: string | null };

export type PurchaseOrderDoc = {
  filename: string;
  lh: Letterhead;
  number: string;
  status: string;
  date: Date;
  deliverBy: Date | null;
  request: string | null;
  job: string | null;
  currency: string;
  supplier: (string | null | undefined)[];
  supplierContact: (string | null | undefined)[];
  /** True when nothing on the order is material, so nothing is delivered. */
  servicesOnly: boolean;
  deliverTo: (string | null | undefined)[];
  lines: Line[];
  total: number;
  notes: string | null;
  terms: string | null;
  raisedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
};

/**
 * Everything that is not a live, approved order says so. Worked from the
 * approved states, so a status added later is marked rather than printed clean.
 */
export function orderWatermark(status: string): string | null {
  if (["Approved", "Partly received", "Received"].includes(status)) return null;
  return ({ Draft: "DRAFT", Rejected: "REJECTED", Cancelled: "CANCELLED" } as Record<string, string>)[status] ?? "NOT APPROVED";
}

export async function loadPurchaseOrder(id: string, companyIds: string[]): Promise<PurchaseOrderDoc | null> {
  const o = await db.purchaseOrder.findFirst({
    where: { id, companyId: { in: companyIds } },
    include: {
      company: { include: { documentSettings: true } },
      party: true,
      store: true,
      // Whether anything on it is material: an order for work is delivered
      // nowhere, and "Deliver to: Main store" on a visa order is wrong on the
      // face of the document the supplier receives.
      job: { select: { code: true, name: true } },
      request: { select: { number: true } },
      lines: { include: { job: { select: { code: true } }, item: { select: { isStocked: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!o) return null;

  const p = o.party;
  const lh = letterheadFor(o.company, o.company.documentSettings);
  const orderJob = o.job?.code ?? null;
  const servicesOnly = isServiceOrder(o.lines);
  return {
    filename: `${o.number.replace(/[^\w-]+/g, "-")}.pdf`,
    lh,
    number: o.number,
    status: o.status,
    date: o.date,
    deliverBy: o.expectedDate,
    request: o.request?.number ?? null,
    job: o.job ? `${o.job.code} — ${o.job.name}` : null,
    currency: o.currency,
    supplier: [
      o.partyName,
      p.addressLine ?? p.address,
      [p.city, p.emirate].filter(Boolean).join(", "),
      p.trn ? `TRN ${p.trn}` : null,
    ],
    supplierContact: [p.contactPerson, p.phone, p.email],
    servicesOnly,
    deliverTo: o.store
      ? [o.store.name, o.store.location, lh.companyName]
      : [lh.companyName, lh.addressLine],
    lines: o.lines.map((l) => ({
      description: l.description,
      unit: l.unitCode,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.netAmount,
      // Shown only where a line goes to a different job from the order's.
      job: l.job && l.job.code !== orderJob ? l.job.code : null,
    })),
    total: o.total,
    notes: o.notes,
    terms: o.company.documentSettings?.purchaseOrderTerms ?? null,
    raisedBy: o.raisedBy,
    approvedBy: o.approvedBy,
    approvedAt: o.approvedAt,
  };
}

export function PurchaseOrderPdf(d: PurchaseOrderDoc) {
  const cur = d.currency || "AED";
  const columns: Column<Line>[] = [
    { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
    { label: "Description", flex: 4, value: (l) => (l.job ? `${l.description}\nFor job ${l.job}` : l.description) },
    { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
    { label: "Unit", flex: 0.9, value: (l) => l.unit },
    { label: `Unit price (${cur})`, flex: 1.4, align: "right", value: (l) => money(l.unitPrice) },
    { label: `Amount (${cur})`, flex: 1.5, align: "right", value: (l) => money(l.amount) },
  ];

  return (
    <DocumentFile lh={d.lh} title={`Purchase order ${d.number}`} watermark={orderWatermark(d.status)}>
      <TitleBlock
        lh={d.lh}
        title="PURCHASE ORDER"
        meta={[
          ["Order no.", d.number],
          ["Date", date(d.date)],
          ["Deliver by", d.deliverBy ? date(d.deliverBy) : ""],
          ["Job", d.job ?? ""],
          ["Our request", d.request ?? ""],
        ]}
      />

      <PartyRow>
        <PartyBox label="Supplier" lines={[...d.supplier, ...d.supplierContact]} />
        <PartyBox label={d.servicesOnly ? "Work for" : "Deliver to"} lines={d.deliverTo} />
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} />

      <TotalsBox
        lh={d.lh}
        rows={[[`Order total, excluding VAT (${cur})`, money(d.total), true]]}
        words={cur === "AED" ? amountInWords(d.total) : null}
      />

      <SmallPrint>
        Quote this order number on your delivery note and your tax invoice. VAT, where it applies, is charged on your
        tax invoice. Goods are accepted only against this order; quantities or prices above it need a revised order
        before delivery.
      </SmallPrint>

      <TextSection heading="Notes" text={d.notes} />
      <TextSection heading="Terms and conditions" text={d.terms} />

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: `For ${d.lh.companyName} — raised by`, name: d.raisedBy },
            { label: "Approved by", name: d.approvedBy, note: d.approvedAt ? date(d.approvedAt) : null },
            { label: "Accepted by the supplier", note: "Name, signature, date and company stamp" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
