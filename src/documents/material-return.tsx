/**
 * The note for material coming back from site.
 *
 * Reusable and scrap are printed apart, because they are different events: one
 * goes back on the shelf and credits the job, the other is logged and the job
 * keeps the cost. A single list would let a scrapped drum be signed for as
 * stock.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { summariseReturn } from "@/lib/returns";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TextSection, SectionHeading, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Line = { code: string; name: string; unit: string; quantity: number; condition: string; value: number; notes: string | null };

export type MaterialReturnDoc = {
  filename: string;
  lh: Letterhead;
  number: string;
  status: string;
  date: Date;
  job: string;
  store: string;
  returnedBy: string;
  lines: Line[];
  creditedToJob: number;
  notes: string | null;
};

export const RETURN_WATERMARK: Record<string, string> = {
  Draft: "DRAFT",
  Cancelled: "CANCELLED",
};

export async function loadMaterialReturn(id: string, companyIds: string[]): Promise<MaterialReturnDoc | null> {
  const r = await db.materialReturn.findFirst({
    where: { id, companyId: { in: companyIds } },
    include: {
      company: { include: { documentSettings: true } },
      job: { select: { code: true, name: true } },
      store: { select: { code: true, name: true } },
      lines: { include: { item: { select: { code: true, name: true, unitCode: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!r) return null;
  return {
    filename: `${r.number.replace(/[^\w-]+/g, "-")}.pdf`,
    lh: letterheadFor(r.company, r.company.documentSettings),
    number: r.number,
    status: r.status,
    date: r.date,
    job: `${r.job.code} — ${r.job.name}`,
    store: `${r.store.code} — ${r.store.name}`,
    returnedBy: r.returnedBy,
    lines: r.lines.map((l) => ({
      code: l.item.code,
      name: l.item.name,
      unit: l.item.unitCode,
      quantity: l.quantity,
      condition: l.condition,
      value: l.value,
      notes: l.notes,
    })),
    creditedToJob: summariseReturn(r.lines).creditedToJob,
    notes: r.notes,
  };
}

export function MaterialReturnPdf(d: MaterialReturnDoc) {
  const posted = d.status === "Posted";
  const columns = (withValue: boolean): Column<Line>[] => [
    { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
    { label: "Item", flex: 1.1, value: (l) => l.code },
    { label: "Description", flex: 3.4, value: (l) => (l.notes ? `${l.name}\n${l.notes}` : l.name) },
    { label: "Qty", flex: 0.9, align: "right", value: (l) => quantity(l.quantity) },
    { label: "Unit", flex: 0.7, value: (l) => l.unit },
    ...(withValue ? [{ label: "Credit (AED)", flex: 1.3, align: "right" as const, value: (l: Line) => (posted ? money(l.value) : "") }] : []),
  ];
  const reusable = d.lines.filter((l) => l.condition === "Reusable");
  const scrap = d.lines.filter((l) => l.condition !== "Reusable");

  return (
    <DocumentFile lh={d.lh} title={`Material return ${d.number}`} watermark={RETURN_WATERMARK[d.status] ?? null}>
      <TitleBlock
        lh={d.lh}
        title="MATERIAL RETURN NOTE"
        subtitle="Material returned from site"
        meta={[
          ["Note no.", d.number],
          ["Date", date(d.date)],
        ]}
      />

      <PartyRow>
        <PartyBox label="From job" lines={[d.job]} />
        <PartyBox label="Into store" lines={[d.store]} />
        <PartyBox label="Brought back by" lines={[d.returnedBy]} />
      </PartyRow>

      {reusable.length ? (
        <>
          <SectionHeading>Reusable — back on the shelf</SectionHeading>
          <ItemsTable lh={d.lh} columns={columns(true)} rows={reusable} />
        </>
      ) : null}
      {scrap.length ? (
        <>
          <SectionHeading>Scrap — logged, not returned to stock</SectionHeading>
          <ItemsTable lh={d.lh} columns={columns(false)} rows={scrap} />
        </>
      ) : null}

      <SmallPrint>
        {posted
          ? `The job has been credited AED ${money(d.creditedToJob)} for the reusable material. Scrap keeps its cost on the job.`
          : "Not yet posted: nothing has gone back into stock and no job has been credited."}
      </SmallPrint>

      <TextSection heading="Notes" text={d.notes} />

      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: "Returned by (site)", name: d.returnedBy },
            { label: "Received and checked by (store)", note: "Name, signature and date" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
