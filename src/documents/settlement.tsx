/**
 * The full and final settlement statement, for the leaving employee to sign.
 *
 * Every figure is the separation's snapshot — basic salary, service, gratuity
 * days — fixed when it was calculated, so a reprint months later says what was
 * agreed and paid rather than what today's records would work out.
 *
 * A statement that has not been approved says DRAFT across the page. An
 * employee must never sign away their claims against a figure nobody signed off.
 */
import React from "react";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { amountInWords } from "@/lib/amount-words";
import {
  DocumentFile, TitleBlock, PartyRow, PartyBox, ItemsTable, TotalsBox, TextSection, Signatures, SmallPrint,
  money, quantity, date, type Column,
} from "./parts";

type Row = { label: string; detail: string; amount: number };

export type SettlementDoc = {
  filename: string;
  lh: Letterhead;
  status: string;
  type: string;
  employee: { name: string; empNo: string; designation: string | null; department: string | null; joinDate: Date | null };
  lastWorkingDay: Date;
  serviceText: string;
  basicSalary: number;
  additions: Row[];
  deductions: number;
  adjustment: number;
  adjustmentNote: string | null;
  net: number;
  preparedBy: string | null;
};

export const settlementWatermark = (status: string): string | null =>
  status === "Approved" || status === "Settled" ? null : "DRAFT";

export async function loadSettlement(id: string, companyIds: string[]): Promise<SettlementDoc | null> {
  const sep = await db.separation.findFirst({
    where: { id, companyId: { in: companyIds } },
    include: { employee: true },
  });
  if (!sep) return null;
  const company = await db.company.findUnique({ where: { id: sep.companyId }, include: { documentSettings: true } });
  if (!company) return null;

  const additions: Row[] = [
    {
      label: "End-of-service gratuity",
      detail: sep.gratuityDays > 0 ? `${quantity(sep.gratuityDays)} days of basic pay` : "Not eligible",
      amount: sep.gratuityAmount,
    },
    { label: "Unused leave encashment", detail: `${quantity(sep.leaveDays)} days`, amount: sep.leaveAmount },
  ];
  if (sep.pendingSalary) additions.push({ label: "Pending salary", detail: "", amount: sep.pendingSalary });
  if (sep.noticePay) additions.push({ label: "Notice pay in lieu", detail: "", amount: sep.noticePay });
  if (sep.airTicket) additions.push({ label: "Repatriation air ticket", detail: "", amount: sep.airTicket });
  if (sep.otherAdditions) additions.push({ label: "Other additions", detail: "", amount: sep.otherAdditions });

  return {
    filename: `Final-settlement-${sep.employee.empNo.replace(/[^\w-]+/g, "-")}.pdf`,
    lh: letterheadFor(company, company.documentSettings),
    status: sep.status,
    type: sep.type,
    employee: {
      name: sep.employee.name,
      empNo: sep.employee.empNo,
      designation: sep.employee.designation,
      department: sep.employee.department,
      joinDate: sep.employee.joinDate,
    },
    lastWorkingDay: sep.lastWorkingDay,
    serviceText: sep.serviceText,
    basicSalary: sep.basicSalary,
    additions,
    deductions: sep.deductions,
    adjustment: sep.adjustment,
    adjustmentNote: sep.adjustmentNote,
    net: sep.netSettlement,
    preparedBy: sep.processedBy,
  };
}

const columns: Column<Row>[] = [
  { label: "Entitlement", flex: 2.6, value: (r) => r.label },
  { label: "Basis", flex: 2.4, value: (r) => r.detail },
  { label: "Amount (AED)", flex: 1.3, align: "right", value: (r) => money(r.amount) },
];

export function SettlementPdf(d: SettlementDoc) {
  const gross = d.additions.reduce((s, r) => s + r.amount, 0);
  const totals: [string, string, boolean?][] = [["Gross entitlements", money(gross)]];
  if (d.deductions) totals.push(["Less deductions", `(${money(d.deductions)})`]);
  if (d.adjustment) {
    totals.push([
      `Adjustment${d.adjustmentNote ? ` — ${d.adjustmentNote}` : ""}`,
      d.adjustment < 0 ? `(${money(-d.adjustment)})` : money(d.adjustment),
    ]);
  }
  totals.push(["Net settlement payable (AED)", money(d.net), true]);

  return (
    <DocumentFile lh={d.lh} title={`Final settlement ${d.employee.empNo}`} watermark={settlementWatermark(d.status)}>
      <TitleBlock
        lh={d.lh}
        title="FULL AND FINAL SETTLEMENT"
        subtitle={`End of service — ${d.type}`}
        meta={[
          ["Employee no.", d.employee.empNo],
          ["Statement date", date(new Date())],
        ]}
      />

      <PartyRow>
        <PartyBox label="Employee" lines={[d.employee.name, d.employee.designation, d.employee.department]} />
        <PartyBox
          label="Service"
          lines={[
            `Joined ${date(d.employee.joinDate)}`,
            `Last working day ${date(d.lastWorkingDay)}`,
            `Length of service ${d.serviceText}`,
            `Basic salary AED ${money(d.basicSalary)}`,
          ]}
        />
      </PartyRow>

      <ItemsTable lh={d.lh} columns={columns} rows={d.additions} />
      <TotalsBox lh={d.lh} rows={totals} words={amountInWords(d.net)} />

      <SmallPrint>
        End-of-service gratuity under Federal Decree-Law No. 33 of 2021: 21 days' basic pay for each of the first five
        years of service and 30 days' basic pay for each year after, subject to at least one year of continuous service
        and a maximum of two years' basic pay. Leave encashment is unused annual leave at the basic daily wage.
      </SmallPrint>

      <TextSection
        heading="Declaration"
        text={`I, ${d.employee.name}, confirm that I have received the amount above as the full and final settlement of all my dues from ${d.lh.companyName}, and that I have no further claim against the company in respect of my employment or its end.`}
      />

      {/* Signatures are the point of this document, whatever the setting. */}
      <Signatures
        boxes={[
          { label: "Employee", name: d.employee.name, note: "Signature and date" },
          { label: `For ${d.lh.companyName}`, name: d.preparedBy, note: "Prepared by — signature and date" },
          { label: "Approved by", note: "Name, signature and date" },
        ]}
      />
    </DocumentFile>
  );
}
