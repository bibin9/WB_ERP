/**
 * A made-up document on the company's real letterhead.
 *
 * So whoever sets up the letterhead can see it on paper before a customer
 * does — artwork that looked right on screen is often too tall, too pale or
 * cropped once it sits across an A4 page. Everything below the letterhead is
 * invented and says so across every page.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { amountInWords } from "@/lib/amount-words";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TotalsBox, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Line = { description: string; unit: string; quantity: number; rate: number };

export type SampleDoc = {
  filename: string;
  lh: Letterhead;
  terms: string | null;
  lines: Line[];
};

const LINES: Line[] = [
  { description: "Supply and install 25 mm GI conduit, including fixings", unit: "Metre", quantity: 120, rate: 18.5 },
  { description: "Distribution board, 12 way, surface mounted", unit: "Number", quantity: 2, rate: 1450 },
  { description: "Testing and commissioning", unit: "Lump sum", quantity: 1, rate: 2200 },
];

/** The id is the company's: the sample is of that company's letterhead. */
export async function loadSample(companyId: string, companyIds: string[]): Promise<SampleDoc | null> {
  if (!companyIds.includes(companyId)) return null;
  const company = await db.company.findUnique({ where: { id: companyId }, include: { documentSettings: true } });
  if (!company) return null;
  return {
    filename: `${company.code}-letterhead-sample.pdf`,
    lh: letterheadFor(company, company.documentSettings),
    terms: company.documentSettings?.quotationTerms ?? null,
    lines: LINES,
  };
}

const columns: Column<Line>[] = [
  { label: "#", flex: 0.4, value: (_, i) => String(i + 1) },
  { label: "Description", flex: 4, value: (l) => l.description },
  { label: "Qty", flex: 0.8, align: "right", value: (l) => quantity(l.quantity) },
  { label: "Unit", flex: 1.1, value: (l) => l.unit },
  { label: "Rate (AED)", flex: 1.2, align: "right", value: (l) => money(l.rate) },
  { label: "Amount (AED)", flex: 1.4, align: "right", value: (l) => money(l.rate * l.quantity) },
];

export function SamplePdf(d: SampleDoc) {
  const total = d.lines.reduce((s, l) => s + l.rate * l.quantity, 0);
  return (
    <DocumentFile lh={d.lh} title="Letterhead sample" watermark="SAMPLE">
      <TitleBlock
        lh={d.lh}
        title="SAMPLE DOCUMENT"
        subtitle="How your documents will look. The lines below are examples."
        meta={[
          ["Number", "SAMPLE-0001"],
          ["Date", date(new Date())],
        ]}
      />
      <PartyRow>
        <PartyBox label="To" lines={["Example Customer LLC", "Office 101, Example Tower", "Business Bay, Dubai", "TRN 100000000000003"]} />
        <PartyBox label="Attention" lines={["Procurement Manager"]} />
      </PartyRow>
      <ItemsTable lh={d.lh} columns={columns} rows={d.lines} />
      <TotalsBox lh={d.lh} rows={[["Total, excluding VAT (AED)", money(total), true]]} words={amountInWords(total)} />
      <TextSection heading="Terms and conditions (your quotation terms)" text={d.terms} />
      {!d.terms ? <SmallPrint>No standard quotation terms are saved yet. They would print here.</SmallPrint> : null}
      {d.lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: `For ${d.lh.companyName} — prepared by`, name: "Example Name" },
            { label: "Approved by" },
            { label: "Accepted by the customer", note: "Name, signature, date and company stamp" },
          ]}
        />
      ) : null}
    </DocumentFile>
  );
}
