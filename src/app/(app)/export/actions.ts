"use server";

import { db } from "@/lib/db";
import { broughtForward, balanceAsAt, openingInPeriod } from "@/lib/ledger";
import { compute, profitFrom, dueDate } from "@/lib/corporatetax";
import { financialYear } from "@/lib/period";
import { getSession, canAdminister } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { toCsv, exportFilename, type Column } from "@/lib/export";
import { createZip } from "@/lib/zip";

/**
 * Data export.
 *
 * This is for portability, auditors and working in Excel — it is NOT the
 * backup. Disaster recovery is Railway's volume snapshots plus the off-platform
 * dump (see BACKUP.md); an export a person has to remember to click is not a
 * recovery plan and must never be described as one.
 *
 * Every export is scoped to one company, gated by the same permission that lets
 * the user open the screen, and written to the audit log — these files carry
 * salaries, passport numbers and IBANs.
 */

export type ExportResult = { ok: boolean; error?: string; filename?: string; content?: string; base64?: string };

const money = (n: number) => Number(n.toFixed(2));

/** Confirms the company is in scope and returns it. */
async function scopedCompany(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  const co = session.companies.find((c) => c.id === companyId);
  if (!co) return null;
  return co;
}

/* ------------------------------------------------------------------ datasets */

type Dataset = {
  screen: string;
  label: string;
  /** Rows for one company, plus the columns to write. */
  build: (companyId: string) => Promise<{ rows: unknown[]; columns: Column<never>[] }>;
};

const employees: Dataset = {
  screen: "hr.employees",
  label: "employees",
  async build(companyId) {
    const rows = await db.employee.findMany({ where: { companyId }, orderBy: { empNo: "asc" } });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Employee No", value: (e) => e.empNo },
      { header: "Name", value: (e) => e.name },
      { header: "Status", value: (e) => e.status },
      { header: "Department", value: (e) => e.department },
      { header: "Designation", value: (e) => e.designation },
      { header: "Grade", value: (e) => e.grade },
      { header: "Employment Type", value: (e) => e.employmentType },
      { header: "Supplier", value: (e) => e.supplier },
      { header: "Join Date", value: (e) => e.joinDate },
      { header: "Nationality", value: (e) => e.nationality },
      { header: "Email", value: (e) => e.email },
      { header: "Phone", value: (e) => e.phone },
      { header: "Basic Salary", value: (e) => money(e.basicSalary) },
      { header: "Allowances", value: (e) => money(e.allowances) },
      { header: "Leave Opening Adjustment", value: (e) => e.annualLeaveBalance },
      { header: "Unpaid Leave Days (life)", value: (e) => e.unpaidLeaveDays },
      { header: "Probation Ends", value: (e) => e.probationEndDate },
      { header: "Probation Cleared", value: (e) => (e.probationCleared ? "Yes" : "") },
      { header: "Notice Period Days", value: (e) => e.noticePeriodDays },
      { header: "Air Ticket Allowance", value: (e) => money(e.airTicketAllowance) },
      { header: "Last Working Day", value: (e) => e.lastWorkingDay },
      { header: "Emirates ID", value: (e) => e.emiratesIdNo },
      { header: "Emirates ID Expiry", value: (e) => e.emiratesIdExpiry },
      { header: "Passport No", value: (e) => e.passportNo },
      { header: "Passport Expiry", value: (e) => e.passportExpiry },
      { header: "Visa No", value: (e) => e.visaNo },
      { header: "Visa Expiry", value: (e) => e.visaExpiry },
      { header: "Labour Card No", value: (e) => e.labourCardNo },
      { header: "Labour Card Expiry", value: (e) => e.labourCardExpiry },
      { header: "Bank", value: (e) => e.bankName },
      { header: "IBAN", value: (e) => e.iban },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const payroll: Dataset = {
  screen: "hr.payroll",
  label: "payroll",
  async build(companyId) {
    const rows = await db.payslip.findMany({
      where: { run: { companyId } },
      include: { run: { select: { period: true, status: true } } },
      orderBy: [{ run: { period: "desc" } }, { empNo: "asc" }],
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Period", value: (p) => p.run.period },
      { header: "Run Status", value: (p) => p.run.status },
      { header: "Employee No", value: (p) => p.empNo },
      { header: "Name", value: (p) => p.employeeName },
      { header: "Days Paid", value: (p) => p.daysPaid },
      { header: "Days In Month", value: (p) => p.daysInPeriod },
      { header: "Part Month Reason", value: (p) => p.partMonthReason },
      { header: "Contract Basic", value: (p) => money(p.contractBasic) },
      { header: "Contract Allowances", value: (p) => money(p.contractAllowances) },
      { header: "Basic", value: (p) => money(p.basic) },
      { header: "Allowances", value: (p) => money(p.allowances) },
      { header: "OT Hours", value: (p) => p.otHours },
      { header: "OT Hours At 150%", value: (p) => p.otPremiumHours },
      { header: "Overtime", value: (p) => money(p.overtime) },
      { header: "Unpaid Days", value: (p) => p.unpaidDays },
      { header: "Absence Deduction", value: (p) => money(p.deductions) },
      { header: "Other Deductions", value: (p) => money(p.otherDeductions) },
      { header: "Deduction Note", value: (p) => p.deductionNote },
      { header: "Advance Recovered", value: (p) => money(p.advanceRecovery) },
      { header: "Net Pay", value: (p) => money(p.netPay) },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const advances: Dataset = {
  screen: "hr.payroll",
  label: "salary-advances",
  async build(companyId) {
    const rows = await db.advance.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Employee", value: (a) => a.employeeName },
      { header: "Amount", value: (a) => money(a.amount) },
      { header: "Monthly Recovery", value: (a) => money(a.monthlyRecovery) },
      { header: "Outstanding", value: (a) => money(a.balance) },
      { header: "Status", value: (a) => a.status },
      { header: "Reason", value: (a) => a.reason },
      { header: "Created", value: (a) => a.createdAt },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const leave: Dataset = {
  screen: "hr.leave",
  label: "leave",
  async build(companyId) {
    const rows = await db.leaveRequest.findMany({
      where: { companyId },
      include: { employee: { select: { empNo: true, name: true } } },
      orderBy: { fromDate: "desc" },
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Employee No", value: (l) => l.employee.empNo },
      { header: "Name", value: (l) => l.employee.name },
      { header: "Type", value: (l) => l.type },
      { header: "From", value: (l) => l.fromDate },
      { header: "To", value: (l) => l.toDate },
      { header: "Days", value: (l) => l.days },
      { header: "Status", value: (l) => l.status },
      { header: "Decided By", value: (l) => l.decidedBy },
      { header: "Reason", value: (l) => l.reason },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const attendance: Dataset = {
  screen: "hr.attendance",
  label: "attendance",
  async build(companyId) {
    const rows = await db.attendance.findMany({
      where: { companyId },
      include: { employee: { select: { empNo: true, name: true } } },
      orderBy: [{ date: "desc" }],
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Date", value: (a) => a.date },
      { header: "Employee No", value: (a) => a.employee.empNo },
      { header: "Name", value: (a) => a.employee.name },
      { header: "Status", value: (a) => a.status },
      { header: "Hours", value: (a) => a.hours },
      { header: "Remarks", value: (a) => a.remarks },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const certifications: Dataset = {
  screen: "hr.certifications",
  label: "certifications",
  async build(companyId) {
    const rows = await db.certification.findMany({
      where: { companyId },
      include: { employee: { select: { empNo: true, name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Employee No", value: (c) => c.employee.empNo },
      { header: "Name", value: (c) => c.employee.name },
      { header: "Certification", value: (c) => c.name },
      { header: "Category", value: (c) => c.category },
      { header: "Issued By", value: (c) => c.issuedBy },
      { header: "Issue Date", value: (c) => c.issueDate },
      { header: "Expiry Date", value: (c) => c.expiryDate },
      { header: "Notes", value: (c) => c.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const separations: Dataset = {
  screen: "hr.separation",
  label: "settlements",
  async build(companyId) {
    const rows = await db.separation.findMany({
      where: { companyId },
      include: { employee: { select: { empNo: true, name: true } } },
      orderBy: { lastWorkingDay: "desc" },
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Employee No", value: (s) => s.employee.empNo },
      { header: "Name", value: (s) => s.employee.name },
      { header: "Type", value: (s) => s.type },
      { header: "Last Working Day", value: (s) => s.lastWorkingDay },
      { header: "Service", value: (s) => s.serviceText },
      { header: "Basic Salary", value: (s) => money(s.basicSalary) },
      { header: "Gratuity Days", value: (s) => s.gratuityDays },
      { header: "Gratuity", value: (s) => money(s.gratuityAmount) },
      { header: "Leave Days", value: (s) => s.leaveDays },
      { header: "Leave Encashment", value: (s) => money(s.leaveAmount) },
      { header: "Pending Salary", value: (s) => money(s.pendingSalary) },
      { header: "Notice Pay", value: (s) => money(s.noticePay) },
      { header: "Air Ticket", value: (s) => money(s.airTicket) },
      { header: "Other Additions", value: (s) => money(s.otherAdditions) },
      { header: "Deductions", value: (s) => money(s.deductions) },
      { header: "Adjustment", value: (s) => money(s.adjustment) },
      { header: "Net Settlement", value: (s) => money(s.netSettlement) },
      { header: "Status", value: (s) => s.status },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const journals: Dataset = {
  screen: "finance.overview",
  label: "journal-entries",
  async build(companyId) {
    const rows = await db.journalEntry.findMany({
      where: { companyId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: { date: "desc" },
    });
    // One row per line, so the export balances and can be pivoted in Excel.
    const flat = rows.flatMap((e) => e.lines.map((l) => ({ e, l })));
    const columns: Column<(typeof flat)[number]>[] = [
      { header: "Date", value: (r) => r.e.date },
      { header: "Reference", value: (r) => r.e.reference },
      { header: "Voucher Type", value: (r) => r.e.voucherType },
      { header: "Party", value: (r) => r.e.partyName },
      { header: "Narration", value: (r) => r.e.memo },
      { header: "Account Code", value: (r) => r.l.account.code },
      { header: "Account", value: (r) => r.l.account.name },
      { header: "Debit", value: (r) => money(r.l.debit) },
      { header: "Credit", value: (r) => money(r.l.credit) },
      { header: "VAT", value: (r) => money(r.e.vatAmount) },
      { header: "Source", value: (r) => r.e.source },
      { header: "Posted By", value: (r) => r.e.postedBy },
    ];
    return { rows: flat, columns: columns as Column<never>[] };
  },
};

const accounts: Dataset = {
  screen: "finance.ledgers",
  label: "chart-of-accounts",
  async build(companyId) {
    const rows = await db.chartOfAccount.findMany({ where: { companyId }, orderBy: { code: "asc" } });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Code", value: (a) => a.code },
      { header: "Name", value: (a) => a.name },
      { header: "Type", value: (a) => a.type },
      { header: "Parent Group", value: (a) => a.parentGroup },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const jobs: Dataset = {
  screen: "finance.jobs",
  label: "jobs",
  async build(companyId) {
    const rows = await db.job.findMany({
      where: { companyId },
      include: { party: { select: { name: true } }, lines: { include: { account: { select: { type: true } } } } },
      orderBy: { code: "asc" },
    });
    const codeById = new Map(rows.map((j) => [j.id, j.code]));
    // Each row carries only what was posted to it; the roll-up is the job
    // screen's job, and doing it here would double-count on a re-import.
    const figures = (j: (typeof rows)[number]) => {
      let revenue = 0, cost = 0;
      for (const l of j.lines) {
        const net = l.debit - l.credit;
        if (l.account.type === "Income") revenue += -net;
        else if (l.account.type === "Expense") cost += net;
      }
      return { revenue, cost, margin: revenue - cost };
    };
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Code", value: (j) => j.code },
      { header: "Job", value: (j) => j.name },
      { header: "Type", value: (j) => j.type },
      // The parent's code rather than its id, so the sheet is readable and can
      // be sorted into the tree without a lookup.
      { header: "Part Of", value: (j) => (j.parentId ? codeById.get(j.parentId) : "") },
      { header: "Customer", value: (j) => j.party?.name },
      { header: "Status", value: (j) => j.status },
      { header: "Start", value: (j) => j.startDate },
      { header: "End", value: (j) => j.endDate },
      { header: "Contract Value", value: (j) => money(j.contractValue) },
      { header: "Budget Cost", value: (j) => money(j.budgetCost) },
      { header: "Revenue", value: (j) => money(figures(j).revenue) },
      { header: "Cost", value: (j) => money(figures(j).cost) },
      { header: "Margin", value: (j) => money(figures(j).margin) },
      { header: "Notes", value: (j) => j.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const costCentres: Dataset = {
  screen: "finance.costcentres",
  label: "cost-centres",
  async build(companyId) {
    const rows = await db.costCentre.findMany({
      where: { companyId },
      include: { lines: { include: { account: { select: { type: true } } } } },
      orderBy: { code: "asc" },
    });
    const codeById = new Map(rows.map((c) => [c.id, c.code]));
    const own = (c: (typeof rows)[number]) => {
      let cost = 0;
      for (const l of c.lines) if (l.account.type === "Expense") cost += l.debit - l.credit;
      return cost;
    };
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Code", value: (c) => c.code },
      { header: "Cost Centre", value: (c) => c.name },
      { header: "Sits Under", value: (c) => (c.parentId ? codeById.get(c.parentId) : "") },
      { header: "Own Cost", value: (c) => money(own(c)) },
      { header: "Active", value: (c) => (c.isActive ? "Yes" : "No") },
      { header: "Notes", value: (c) => c.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const trialBalance: Dataset = {
  screen: "finance.reports",
  label: "trial-balance",
  async build(companyId) {
    const company = await db.company.findUnique({ where: { id: companyId } });
    // The financial year to date, which is what an auditor asks for. A narrower
    // range is available on screen; the file is the standard one.
    const fy = financialYear(company?.fyStartMonth ?? 1, new Date());
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId },
      include: { lines: { include: { entry: { select: { date: true } } } } },
      orderBy: { code: "asc" },
    });
    const dr = (v: number) => (v > 0 ? v : 0);
    const cr = (v: number) => (v < 0 ? -v : 0);
    const rows = accounts.map((a) => {
      const opening = broughtForward(a, fy.from, company?.openingAsOf);
      const closing = balanceAsAt(a, fy.to, company?.openingAsOf);
      const inPeriod = a.lines.filter((l) => l.entry.date >= fy.from && l.entry.date <= fy.to);
      const openingHere = openingInPeriod(company?.openingAsOf, fy.from, fy.to) ? a.openingBalance : 0;
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        openingDr: dr(opening),
        openingCr: cr(opening),
        periodDr: inPeriod.reduce((t, l) => t + l.debit, 0) + dr(openingHere),
        periodCr: inPeriod.reduce((t, l) => t + l.credit, 0) + cr(openingHere),
        closingDr: dr(closing),
        closingCr: cr(closing),
      };
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Code", value: (r) => r.code },
      { header: "Account", value: (r) => r.name },
      { header: "Type", value: (r) => r.type },
      { header: "Opening Dr", value: (r) => money(r.openingDr) },
      { header: "Opening Cr", value: (r) => money(r.openingCr) },
      { header: "Period Dr", value: (r) => money(r.periodDr) },
      { header: "Period Cr", value: (r) => money(r.periodCr) },
      { header: "Closing Dr", value: (r) => money(r.closingDr) },
      { header: "Closing Cr", value: (r) => money(r.closingCr) },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const cheques: Dataset = {
  screen: "finance.cheques",
  label: "cheque-register",
  async build(companyId) {
    const rows = await db.cheque.findMany({
      where: { companyId },
      include: { entry: { select: { reference: true } } },
      orderBy: [{ chequeDate: "asc" }],
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Cheque Date", value: (c) => c.chequeDate },
      { header: "Direction", value: (c) => c.direction },
      { header: "Cheque No", value: (c) => c.chequeNo },
      { header: "Bank", value: (c) => c.bankName },
      { header: "Party", value: (c) => c.partyName },
      { header: "Amount", value: (c) => money(c.amount) },
      { header: "Status", value: (c) => c.status },
      { header: "Held By", value: (c) => c.heldBy },
      { header: "Deposited", value: (c) => c.depositedOn },
      { header: "Settled", value: (c) => c.settledOn },
      { header: "Voucher", value: (c) => c.entry?.reference },
      { header: "Notes", value: (c) => c.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

const retention: Dataset = {
  screen: "finance.retention",
  label: "retention-register",
  async build(companyId) {
    const rows = await db.retention.findMany({
      where: { companyId },
      include: { job: { select: { code: true } }, entry: { select: { reference: true } } },
      orderBy: [{ dueDate: "asc" }],
    });
    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Releasable On", value: (r) => r.dueDate },
      { header: "Direction", value: (r) => r.direction },
      { header: "Certificate", value: (r) => r.reference },
      { header: "Job", value: (r) => r.job?.code },
      { header: "Party", value: (r) => r.partyName },
      { header: "Stage", value: (r) => r.stage },
      { header: "Rate %", value: (r) => r.percent },
      { header: "Amount", value: (r) => money(r.amount) },
      { header: "Status", value: (r) => r.status },
      { header: "Released On", value: (r) => r.releasedOn },
      { header: "Voucher", value: (r) => r.entry?.reference },
      { header: "Notes", value: (r) => r.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

/**
 * The corporate tax computation, one row per tax period.
 *
 * The adjustment detail stays on the screen, where each line carries its own
 * reason; what an auditor or a tax adviser asks for as a file is the
 * reconciliation itself — accounting profit through to tax payable, with the
 * filing reference beside it.
 */
const corporateTax: Dataset = {
  screen: "finance.corptax",
  label: "corporate-tax",
  async build(companyId) {
    const returns = await db.corporateTaxReturn.findMany({
      where: { companyId },
      include: { adjustments: true },
      orderBy: [{ periodTo: "desc" }],
    });
    const company = await db.company.findUnique({ where: { id: companyId } });
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId, type: { in: ["Income", "Expense"] } },
      include: { lines: { include: { entry: { select: { date: true } } } } },
    });

    const rows = returns.map((r) => {
      const pl = profitFrom(accounts, r.periodFrom, r.periodTo, company?.openingAsOf);
      const c = compute({
        accountingProfit: pl.accountingProfit,
        revenue: pl.income,
        adjustments: r.adjustments,
        lossesBroughtForward: r.lossesBroughtForward,
        sbrElected: r.sbrElected,
        periodTo: r.periodTo,
      });
      return { r, c, due: dueDate(r.periodTo) };
    });

    const columns: Column<(typeof rows)[number]>[] = [
      { header: "Period From", value: (x) => x.r.periodFrom },
      { header: "Period To", value: (x) => x.r.periodTo },
      { header: "Due", value: (x) => x.due },
      { header: "Status", value: (x) => x.r.status },
      { header: "Revenue", value: (x) => money(x.c.revenue) },
      { header: "Accounting Profit", value: (x) => money(x.c.accountingProfit) },
      { header: "Add Backs", value: (x) => money(x.c.addBacks) },
      { header: "Deductions", value: (x) => money(x.c.deductions) },
      { header: "Exempt Income", value: (x) => money(x.c.exemptIncome) },
      { header: "Taxable Before Losses", value: (x) => money(x.c.adjustedProfit) },
      { header: "Losses Brought Forward", value: (x) => money(x.c.lossesBroughtForward) },
      { header: "Loss Relief Used", value: (x) => money(x.c.lossRelief) },
      { header: "Losses Carried Forward", value: (x) => money(x.c.lossesCarriedForward) },
      { header: "Taxable Income", value: (x) => money(x.c.taxableIncome) },
      { header: "Charged At 9%", value: (x) => money(x.c.chargeable) },
      { header: "Small Business Relief", value: (x) => (x.c.sbrApplied ? "Claimed" : "") },
      { header: "Tax Payable", value: (x) => money(x.c.taxPayable) },
      { header: "Filed On", value: (x) => x.r.filedOn },
      { header: "EmaraTax Reference", value: (x) => x.r.filedRef },
      { header: "Notes", value: (x) => x.r.notes },
    ];
    return { rows, columns: columns as Column<never>[] };
  },
};

/** Every dataset the app can export, keyed by the name used in the UI.
 *  Not exported: a "use server" module may only export async functions. */
const DATASETS: Record<string, Dataset> = {
  employees,
  payroll,
  advances,
  leave,
  attendance,
  certifications,
  separations,
  journals,
  accounts,
  trialBalance,
  cheques,
  retention,
  corporateTax,
  jobs,
  costCentres,
};

/* ------------------------------------------------------------- single export */

/**
 * Export one dataset as CSV. Gated by the screen the data belongs to.
 * `companyId` of "*" means every company the user can access, with the company
 * code added as the first column — used on screens that span the group.
 */
export async function exportDataset(key: string, companyId: string): Promise<ExportResult> {
  const ds = DATASETS[key];
  if (!ds) return { ok: false, error: "Unknown export" };
  if (!(await allow(ds.screen, "view"))) return { ok: false, error: "Not authorised" };

  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const targets =
    companyId === "*"
      ? session.companies
      : session.companies.filter((c) => c.id === companyId);
  if (targets.length === 0) return { ok: false, error: "No access to this company" };

  let rows: unknown[] = [];
  let columns: Column<never>[] = [];
  if (targets.length === 1) {
    ({ rows, columns } = await ds.build(targets[0].id));
  } else {
    // Tag each row with its company so a group-wide export stays readable.
    const tagged: { company: string; row: unknown }[] = [];
    for (const t of targets) {
      const part = await ds.build(t.id);
      columns = part.columns;
      for (const r of part.rows) tagged.push({ company: t.code, row: r });
    }
    columns = [
      { header: "Company", value: (x: never) => (x as unknown as { company: string }).company },
      ...columns.map((c) => ({
        header: c.header,
        value: (x: never) => c.value((x as unknown as { row: never }).row),
      })),
    ] as Column<never>[];
    rows = tagged;
  }
  if (rows.length === 0) return { ok: false, error: "Nothing to export yet" };

  const co = targets.length === 1 ? targets[0].code : "GROUP";
  const content = toCsv(rows as never[], columns);
  const filename = exportFilename(ds.label, co);
  await audit({
    action: "Posted",
    entity: "Export",
    summary: `Exported ${ds.label} for ${co} (${rows.length} rows)`,
  });
  return { ok: true, filename, content };
}

/* ---------------------------------------------------------------- export all */

/**
 * Everything the company holds, as a ZIP of CSVs. Administrators only — this is
 * the whole HR and finance record in one file.
 */
export async function exportEverything(companyId: string): Promise<ExportResult> {
  const co = await scopedCompany(companyId);
  if (!co) return { ok: false, error: "No access to this company" };
  if (!(await canAdminister())) return { ok: false, error: "Only administrators can export all data" };

  const files: { name: string; data: string }[] = [];
  let total = 0;
  for (const [key, ds] of Object.entries(DATASETS)) {
    const { rows, columns } = await ds.build(companyId);
    if (rows.length === 0) continue;
    files.push({ name: `${ds.label}.csv`, data: toCsv(rows as never[], columns) });
    total += rows.length;
  }
  if (files.length === 0) return { ok: false, error: "There is no data to export yet" };

  files.push({
    name: "README.txt",
    data:
      `${co.name} (${co.code}) — data export\r\n` +
      `Generated ${new Date().toISOString()}\r\n\r\n` +
      files.map((f) => `  ${f.name}`).join("\r\n") +
      `\r\n\r\nOpen the CSV files in Excel. They are UTF-8 encoded.\r\n\r\n` +
      `This export is for your records and for moving data elsewhere. It is NOT a\r\n` +
      `system backup — it holds no schema, no uploaded document files and no\r\n` +
      `restore path. Ask your administrator about the backup schedule.\r\n\r\n` +
      `It contains personal data — salaries, passport and Emirates ID numbers and\r\n` +
      `bank details. Store it securely and delete copies you no longer need.\r\n`,
  });

  const zip = createZip(files);
  await audit({
    action: "Posted",
    entity: "Export",
    summary: `Exported ALL data for ${co.code} (${files.length - 1} files, ${total} rows)`,
  });
  return { ok: true, filename: exportFilename("all-data", co.code, "zip"), base64: zip.toString("base64") };
}
