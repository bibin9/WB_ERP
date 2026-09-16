/**
 * Payslips — one employee's, or a whole run with each employee on a page of
 * their own, so HR can print the month in one go and hand them out.
 *
 * Every figure is the payslip's own, as the run calculated it. A salary changed
 * on the employee record next month must not change what this month says.
 *
 * Salaries are personal. The route is guarded by the payroll screen and the
 * company like every other document, and the bank account is printed masked:
 * the slip confirms where the money went without handing anyone who picks it
 * up off the printer a full IBAN.
 */
import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { letterheadFor, type Letterhead } from "@/lib/document-settings";
import { amountInWords } from "@/lib/amount-words";
import { DocumentFile, PartyRow, PartyBox, ItemsTable, TotalsBox, SmallPrint, Signatures, money, quantity, type Column } from "./parts";

export type SlipData = {
  empNo: string;
  name: string;
  designation: string | null;
  department: string | null;
  bank: string | null;
  daysPaid: number;
  daysInPeriod: number;
  partMonthReason: string | null;
  basic: number;
  allowances: number;
  contractBasic: number;
  contractAllowances: number;
  otHours: number;
  otPremiumHours: number;
  overtime: number;
  unpaidDays: number;
  absence: number;
  otherDeductions: number;
  deductionNote: string | null;
  advanceRecovery: number;
  netPay: number;
};

export type PayslipsDoc = {
  filename: string;
  lh: Letterhead;
  period: string;
  status: string;
  slips: SlipData[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-08" → "August 2026". */
export const periodLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : period;
};

/** Bank name and the last four characters of the IBAN, never the whole number. */
export const maskedBank = (bankName: string | null | undefined, iban: string | null | undefined) => {
  const tail = String(iban ?? "").replace(/\s+/g, "").slice(-4);
  const parts = [bankName?.trim(), tail ? `account ending ${tail}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

/** A run that is not approved is a calculation, not a payslip. */
export const payslipWatermark = (status: string): string | null =>
  status === "Approved" || status === "Paid" ? null : "DRAFT";

async function slipsFor(where: { runId?: string; id?: string }, companyIds: string[]) {
  const slips = await db.payslip.findMany({
    where: { ...where, run: { companyId: { in: companyIds } } },
    include: { run: { include: { company: { include: { documentSettings: true } } } } },
    orderBy: { empNo: "asc" },
  });
  if (!slips.length) return null;
  const employees = await db.employee.findMany({
    where: { id: { in: slips.map((s) => s.employeeId) } },
    select: { id: true, designation: true, department: true, bankName: true, iban: true },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const run = slips[0].run;
  return {
    run,
    lh: letterheadFor(run.company, run.company.documentSettings),
    slips: slips.map((s): SlipData => {
      const e = byId.get(s.employeeId);
      return {
        empNo: s.empNo,
        name: s.employeeName,
        designation: e?.designation ?? null,
        department: e?.department ?? null,
        bank: maskedBank(e?.bankName, e?.iban),
        daysPaid: s.daysPaid,
        daysInPeriod: s.daysInPeriod,
        partMonthReason: s.partMonthReason,
        basic: s.basic,
        allowances: s.allowances,
        contractBasic: s.contractBasic,
        contractAllowances: s.contractAllowances,
        otHours: s.otHours,
        otPremiumHours: s.otPremiumHours,
        overtime: s.overtime,
        unpaidDays: s.unpaidDays,
        absence: s.deductions,
        otherDeductions: s.otherDeductions,
        deductionNote: s.deductionNote,
        advanceRecovery: s.advanceRecovery,
        netPay: s.netPay,
      };
    }),
  };
}

/** One employee's payslip. */
export async function loadPayslip(id: string, companyIds: string[]): Promise<PayslipsDoc | null> {
  const found = await slipsFor({ id }, companyIds);
  if (!found) return null;
  const s = found.slips[0];
  return {
    filename: `Payslip-${found.run.period}-${s.empNo.replace(/[^\w-]+/g, "-")}.pdf`,
    lh: found.lh,
    period: found.run.period,
    status: found.run.status,
    slips: found.slips,
  };
}

/** Every payslip in a run, a page each. */
export async function loadPayrollRun(id: string, companyIds: string[]): Promise<PayslipsDoc | null> {
  const found = await slipsFor({ runId: id }, companyIds);
  if (!found) return null;
  return {
    filename: `Payslips-${found.run.company.code}-${found.run.period}.pdf`,
    lh: found.lh,
    period: found.run.period,
    status: found.run.status,
    slips: found.slips,
  };
}

type Row = { label: string; detail: string; amount: number };

const earningColumns: Column<Row>[] = [
  { label: "Earnings", flex: 2.4, value: (r) => r.label },
  { label: "Basis", flex: 2.6, value: (r) => r.detail },
  { label: "Amount (AED)", flex: 1.3, align: "right", value: (r) => money(r.amount) },
];
const deductionColumns: Column<Row>[] = [
  { label: "Deductions", flex: 2.4, value: (r) => r.label },
  { label: "Basis", flex: 2.6, value: (r) => r.detail },
  { label: "Amount (AED)", flex: 1.3, align: "right", value: (r) => money(r.amount) },
];

function Slip({ lh, period, s, first }: { lh: Letterhead; period: string; s: SlipData; first: boolean }) {
  const part = s.daysPaid < s.daysInPeriod;
  const earnings: Row[] = [
    { label: "Basic salary", detail: part ? `${quantity(s.daysPaid)} of ${s.daysInPeriod} days on ${money(s.contractBasic)}` : "Monthly", amount: s.basic },
    { label: "Allowances", detail: part ? `${quantity(s.daysPaid)} of ${s.daysInPeriod} days on ${money(s.contractAllowances)}` : "Monthly", amount: s.allowances },
  ];
  if (s.overtime) {
    const hours = [s.otHours ? `${quantity(s.otHours)} h` : null, s.otPremiumHours ? `${quantity(s.otPremiumHours)} h night / rest day` : null]
      .filter(Boolean)
      .join(" + ");
    earnings.push({ label: "Overtime", detail: hours, amount: s.overtime });
  }
  const deductions: Row[] = [];
  if (s.absence) deductions.push({ label: "Unpaid days", detail: `${quantity(s.unpaidDays)} day${s.unpaidDays === 1 ? "" : "s"}`, amount: s.absence });
  if (s.otherDeductions) deductions.push({ label: "Other deductions", detail: s.deductionNote ?? "", amount: s.otherDeductions });
  if (s.advanceRecovery) deductions.push({ label: "Salary advance recovered", detail: "Instalment", amount: s.advanceRecovery });

  const gross = s.basic + s.allowances + s.overtime;
  const totalDeductions = s.absence + s.otherDeductions + s.advanceRecovery;

  return (
    // A page of its own for each employee after the first.
    <View break={!first}>
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 18, lineHeight: 1.15, color: lh.accent }}>PAYSLIP</Text>
      </View>
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: "#5B6472" }}>{periodLabel(period)}</Text>
      </View>

      <PartyRow>
        <PartyBox label="Employee" lines={[s.name, `Employee no. ${s.empNo}`, s.designation, s.department]} />
        <PartyBox
          label="Pay period"
          lines={[periodLabel(period), `${quantity(s.daysPaid)} of ${s.daysInPeriod} days paid`, s.partMonthReason, s.bank ? `Paid to ${s.bank}` : null]}
        />
      </PartyRow>

      <ItemsTable lh={lh} columns={earningColumns} rows={earnings} />
      {deductions.length ? <ItemsTable lh={lh} columns={deductionColumns} rows={deductions} /> : null}

      <TotalsBox
        lh={lh}
        rows={[
          ["Gross earnings", money(gross)],
          ["Total deductions", money(totalDeductions)],
          ["Net pay (AED)", money(s.netPay), true],
        ]}
        words={amountInWords(s.netPay)}
      />

      <SmallPrint>
        Salary is paid through the Wage Protection System. Keep this payslip; query anything on it with HR within the month.
      </SmallPrint>

      {lh.showSignatures ? (
        <Signatures
          boxes={[
            { label: "For the company (HR)", note: "Name, signature and date" },
            { label: "Received by the employee", note: `${s.name} — signature and date` },
          ]}
        />
      ) : null}
    </View>
  );
}

export function PayslipsPdf(d: PayslipsDoc) {
  return (
    <DocumentFile
      lh={d.lh}
      title={d.slips.length === 1 ? `Payslip ${d.slips[0].empNo} ${periodLabel(d.period)}` : `Payslips ${periodLabel(d.period)}`}
      watermark={payslipWatermark(d.status)}
    >
      {d.slips.map((s, i) => (
        <Slip key={s.empNo} lh={d.lh} period={d.period} s={s} first={i === 0} />
      ))}
    </DocumentFile>
  );
}
