/**
 * A material request on paper — for the site to sign, and for the store or the
 * buyer to work from where there is no screen to hand.
 *
 * Internal, so it carries no prices. Until it is approved it says so across
 * the page: a request nobody has approved is a wish, not an instruction to buy.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TextSection, Signatures,
  quantity, date, type Column,
} from "./parts";

type Line = { code: string | null; description: string; unit: string; quantity: number; notes: string | null };

export type MaterialRequestDoc = {
  filename: string;
  lh: Letterhead;
  number: string;
  status: string;
  raisedOn: Date;
  neededBy: Date | null;
  job: string | null;
  store: string | null;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  lines: Line[];
  notes: string | null;
  followUps: string[];
};

/**
 * The mark across the page, or none.
 *
 * Worked from the statuses that ARE approved rather than a list of those that
 * are not: the first version listed "Awaiting approval", the request's real
 * state is "Submitted", and a request nobody had approved printed clean. Any
 * status added later is marked until someone decides otherwise.
 */
export function requestWatermark(status: string): string | null {
  if (status === "Approved" || status === "Ordered") return null;
  return ({ Draft: "DRAFT", Rejected: "REJECTED", Cancelled: "CANCELLED" } as Record<string, string>)[status] ?? "NOT APPROVED";
}

export async function loadMaterialRequest(id: string, companyIds: string[]): Promise<MaterialRequestDoc | null> {
  const r = await db.materialRequest.findFirst({
    where: { id, companyId: { in: companyIds } },
    include: {
      company: { include: { documentSettings: true } },
      job: { select: { code: true, name: true } },
      store: { select: { code: true, name: true } },
      lines: { include: { item: { select: { code: true } } }, orderBy: { order: "asc" } },
      orders: { select: { number: true } },
      rfqs: { select: { number: true } },
    },
  });
  if (!r) return null;

  // Who approved it is on the approval, not the request. The last step decided
  // is the one that let it through.
  const approval = r.approvalRequestId
    ? await db.approvalRequest.findUnique({
        where: { id: r.approvalRequestId },
        include: { steps: { where: { status: "Approved" }, orderBy: { order: "desc" }, take: 1 } },
      })
    : null;
  const step = approval?.status === "Approved" ? approval.steps[0] : null;

  return {
    filename: `${r.number.replace(/[^\w-]+/g, "-")}.pdf`,
    lh: letterheadFor(r.company, r.company.documentSettings),
    number: r.number,
    status: r.status,
    raisedOn: r.createdAt,
    neededBy: r.neededBy,
    job: r.job ? `${r.job.code} — ${r.job.name}` : null,
    store: r.store ? `${r.store.code} — ${r.store.name}` : null,
    requestedBy: r.requestedBy,
    approvedBy: step?.decidedBy ?? null,
    approvedAt: step?.decidedAt ?? null,
    lines: r.lines.map((l) => ({
      code: l.item?.code ?? null,
      description: l.description,
      unit: l.unitCode,
      quantity: l.quantity,
      notes: l.notes,
    })),
    notes: r.notes,
    followUps: [
      ...r.rfqs.map((x) => `Enquiry ${x.number}`),
      ...r.orders.map((x) => `Purchase order ${x.number}`),
    ],
  };
}

const columns: Column<Line>[] = [
  { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
  { label: "Item", flex: 1.1, value: (l) => l.code ?? "—" },
  { label: "Description", flex: 3.6, value: (l) => (l.notes ? `${l.description}\n${l.notes}` : l.description) },
  { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
  { label: "Unit", flex: 0.8, value: (l) => l.unit },
  { label: "Issued / ordered", flex: 1.4, align: "right", value: () => "" },
];

export function MaterialRequestPdf(d: MaterialRequestDoc) {
  return (
    <DocumentFile lh={d.lh} title={`Material request ${d.number}`} watermark={requestWatermark(d.status)}>
      <TitleBlock
        lh={d.lh}
        title="MATERIAL REQUEST"
        subtitle={`Status: ${d.status}`}
        meta={[
          ["Request no.", d.number],
          ["Raised", date(d.raisedOn)],
          ["Needed by", d.neededBy ? date(d.neededBy) : ""],
        ]}
      />

      <PartyRow>
        <PartyBox label="For job" lines={[d.job ?? "Not for a particular job"]} />
        <PartyBox label="Deliver to store" lines={[d.store ?? "Not stated"]} />
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} minRowHeight={20} />

      <TextSection heading="Notes" text={d.notes} />
      <TextSection heading="Followed up by" text={d.followUps.join("\n")} />

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: "Requested by", name: d.requestedBy },
            { label: "Approved by", name: d.approvedBy, note: d.approvedAt ? date(d.approvedAt) : null },
            { label: "Received by (store / procurement)", note: "Name, signature and date" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
