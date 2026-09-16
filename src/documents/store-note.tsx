/**
 * The paper that goes with material as it moves: a goods received note when a
 * delivery arrives, an issue note when it leaves the store for a job, a return
 * note when it goes back to a supplier, a transfer note between stores.
 *
 * A delivery of five items is recorded as five movements, one per item, all
 * against the same delivery note. The note is those movements together — the
 * same kind, the same reference, the same day, the same store, the same
 * supplier or job — so it matches the paper the driver handed over rather than
 * printing five notes for one lorry.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { NOTE_TITLES, hasStoreNote } from "@/lib/store-notes";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Line = {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  bin: string | null;
  order: string | null;
  inspection: string | null;
  value: number;
};

export type StoreNoteDoc = {
  filename: string;
  lh: Letterhead;
  kind: string;
  title: string;
  reference: string;
  date: Date;
  store: string;
  toStore: string | null;
  party: (string | null | undefined)[] | null;
  job: string | null;
  lines: Line[];
  notes: string[];
  postedBy: string | null;
  /** Whether values print. A receipt note goes to the supplier's driver; an issue note stays in. */
  showValues: boolean;
};

export async function loadStoreNote(id: string, companyIds: string[]): Promise<StoreNoteDoc | null> {
  const anchor = await db.stockMovement.findFirst({ where: { id, companyId: { in: companyIds } } });
  if (!anchor || !hasStoreNote(anchor.kind)) return null;

  // A transfer is one note for both ends: it is printed from the "out" side.
  const outKind = anchor.kind === "Transfer in" ? "Transfer out" : anchor.kind;
  const transfer = outKind === "Transfer out";

  const rows = await db.stockMovement.findMany({
    where: {
      companyId: anchor.companyId,
      kind: outKind,
      reference: anchor.reference,
      date: anchor.date,
      ...(transfer ? {} : { storeId: anchor.storeId, partyId: anchor.partyId, jobId: anchor.jobId }),
    },
    include: {
      item: { select: { code: true, name: true, unitCode: true } },
      store: { select: { code: true, name: true } },
      bin: { select: { code: true } },
      purchaseOrderLine: { select: { order: { select: { number: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return null;

  const arrivals = transfer
    ? await db.stockMovement.findMany({
        where: { companyId: anchor.companyId, kind: "Transfer in", reference: anchor.reference, date: anchor.date },
        include: { store: { select: { code: true, name: true } } },
      })
    : [];

  const first = rows[0];
  const [company, party, job] = await Promise.all([
    db.company.findUnique({ where: { id: anchor.companyId }, include: { documentSettings: true } }),
    first.partyId ? db.party.findUnique({ where: { id: first.partyId } }) : null,
    first.jobId ? db.job.findUnique({ where: { id: first.jobId }, select: { code: true, name: true } }) : null,
  ]);
  if (!company) return null;

  const kind = outKind;
  const orders = [...new Set(rows.map((r) => r.purchaseOrderLine?.order.number).filter(Boolean))] as string[];
  return {
    filename: `${kind.replace(/\s+/g, "-")}-${anchor.reference.replace(/[^\w-]+/g, "-") || "note"}.pdf`,
    lh: letterheadFor(company, company.documentSettings),
    kind,
    title: NOTE_TITLES[kind],
    reference: anchor.reference,
    date: anchor.date,
    store: `${first.store.code} — ${first.store.name}`,
    toStore: arrivals[0] ? `${arrivals[0].store.code} — ${arrivals[0].store.name}` : null,
    party: party
      ? [party.name, party.addressLine ?? party.address, [party.city, party.emirate].filter(Boolean).join(", ")]
      : null,
    job: job ? `${job.code} — ${job.name}` : null,
    lines: rows.map((r) => ({
      code: r.item.code,
      name: r.item.name,
      unit: r.item.unitCode,
      quantity: r.quantity,
      bin: r.bin?.code ?? null,
      order: r.purchaseOrderLine?.order.number ?? null,
      inspection: r.inspection,
      value: r.value,
    })),
    notes: [
      ...(orders.length ? [`Against purchase order ${orders.join(", ")}.`] : []),
      ...[...new Set(rows.map((r) => r.notes).filter(Boolean))] as string[],
    ],
    postedBy: first.createdBy,
    showValues: kind === "Issue" || kind === "Transfer out",
  };
}

export function StoreNotePdf(d: StoreNoteDoc) {
  const receipt = d.kind === "Receipt";
  const columns: Column<Line>[] = [
    { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
    { label: "Item", flex: 1.1, value: (l) => l.code },
    { label: "Description", flex: 3.2, value: (l) => l.name },
    { label: "Bin", flex: 0.9, value: (l) => l.bin ?? "" },
    { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
    { label: "Unit", flex: 0.7, value: (l) => l.unit },
    ...(receipt ? [{ label: "Inspection", flex: 1.1, value: (l: Line) => l.inspection ?? "" }] : []),
    ...(d.showValues ? [{ label: "Value (AED)", flex: 1.3, align: "right" as const, value: (l: Line) => money(l.value) }] : []),
  ];
  const total = d.lines.reduce((s, l) => s + l.value, 0);

  const partyLabel = receipt ? "Received from" : "Returned to";
  const signatures =
    d.kind === "Issue"
      ? [
          { label: "Issued by (store)", name: d.postedBy },
          { label: "Received by (site)", note: "Name, signature and date" },
          { label: "Checked by", note: "Name, signature and date" },
        ]
      : receipt
        ? [
            { label: "Received by (store)", name: d.postedBy },
            { label: "Inspected by (QA/QC)", note: "Name, signature and date" },
            { label: "Delivered by (driver)", note: "Name, vehicle no. and signature" },
          ]
        : d.kind === "Return to supplier"
          ? [
              { label: "Released by (store)", name: d.postedBy },
              { label: "Collected by (supplier)", note: "Name, vehicle no. and signature" },
            ]
          : [
              { label: "Sent by", name: d.postedBy },
              { label: "Received by (receiving store)", note: "Name, signature and date" },
            ];

  return (
    <DocumentFile lh={d.lh} title={`${d.title} ${d.reference}`}>
      <TitleBlock
        lh={d.lh}
        title={d.title}
        meta={[
          [receipt ? "Delivery note" : "Reference", d.reference],
          ["Date", date(d.date)],
          // An issue names its job in its own box below.
          ["Job", d.kind === "Issue" ? "" : d.job ?? ""],
        ]}
      />

      <PartyRow>
        {d.party ? <PartyBox label={partyLabel} lines={d.party} /> : null}
        <PartyBox label={d.kind === "Transfer out" ? "From store" : receipt ? "Into store" : "From store"} lines={[d.store]} />
        {d.toStore ? <PartyBox label="To store" lines={[d.toStore]} /> : null}
        {d.kind === "Issue" && d.job ? <PartyBox label="Issued to job" lines={[d.job]} /> : null}
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} />

      {d.showValues ? (
        <SmallPrint>Total value at cost: AED {money(total)}. Values are what the stock cost, not a selling price.</SmallPrint>
      ) : null}
      {receipt ? (
        <SmallPrint>
          Received subject to inspection. Quantities are as counted at the store; anything that fails inspection is held
          and returned to the supplier.
        </SmallPrint>
      ) : null}

      <TextSection heading="Notes" text={d.notes.join("\n")} />

      {d.lh.showSignatures ? <Signatures boxes={signatures} /> : null}
    </DocumentFile>
  );
}
