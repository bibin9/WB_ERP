"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildSif, splitFixedVariable, type SifEmployee } from "@/lib/wps";
import { allow } from "@/lib/guard";
import { cleanIban, cleanLabourCard, cleanRouting } from "@/lib/uae";
import { computePayslip, payrollReadiness, sickSplit } from "@/lib/payroll";
import { postVoucher } from "@/lib/posting";

/**
 * Where a month of wages lands in the books.
 *
 * The salary cost, the bank, and the advance the employee is paying back —
 * which is an asset until it is recovered, not a cost the month it is lent.
 */
const SALARY_EXPENSE_CODE = "6000";
const BANK_CODE = "1000";
const ADVANCE_CODE = "1170";
import { money } from "@/lib/money";

/** The validators the readiness gate uses, in one place. */
const WPS_VALIDATORS = { iban: cleanIban, labourCard: cleanLabourCard, routing: cleanRouting };

/** First and last day of a "YYYY-MM" period, as UTC midnights. */
function monthBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 0)),
  };
}

const DAY_MS = 86_400_000;
const overlapDays = (aFrom: Date, aTo: Date, bFrom: Date, bTo: Date) => {
  const from = Math.max(aFrom.getTime(), bFrom.getTime());
  const to = Math.min(aTo.getTime(), bTo.getTime());
  return to < from ? 0 : Math.round((to - from) / DAY_MS) + 1;
};

/**
 * The start of the year of service the period falls in.
 *
 * Sick leave is ninety days "per year", and the year the law means is the year
 * of service, not the calendar one — so a man who joined in March starts a
 * fresh ninety days each March, not each January.
 */
function serviceYearStart(joinDate: Date | null | undefined, on: Date): Date {
  if (!joinDate) return new Date(Date.UTC(on.getUTCFullYear(), 0, 1));
  let year = on.getUTCFullYear();
  let anniversary = new Date(Date.UTC(year, joinDate.getUTCMonth(), joinDate.getUTCDate()));
  if (anniversary > on) anniversary = new Date(Date.UTC(year - 1, joinDate.getUTCMonth(), joinDate.getUTCDate()));
  return anniversary < joinDate ? joinDate : anniversary;
}

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session || !session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

export async function createPayrollRun(formData: FormData) {
  if (!(await allow("hr.payroll", "create"))) return;
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const companyId = String(formData.get("companyId") || "");
  const period = String(formData.get("period") || "").trim();
  if (!session.companies.some((c) => c.id === companyId) || !/^\d{4}-\d{2}$/.test(period))
    return { ok: false, error: "Pick a valid month" };

  const existing = await db.payrollRun.findUnique({ where: { companyId_period: { companyId, period } } });
  if (existing) return { ok: false, error: "Payroll already run for this month" };

  const { start, end } = monthBounds(period);

  // Somebody who left before the month began is not on this payroll; somebody
  // who left during it is, for the days he worked. Filtering on status alone
  // paid a mid-month leaver nothing at all.
  const employees = await db.employee.findMany({
    where: {
      companyId,
      // Supplied labour sits on the agency's establishment card and the
      // agency's WPS. The company pays the agency an invoice; putting the man
      // on its own payroll puts a name on its MOL file that MOHRE never
      // sponsored, and pays him twice into the bargain.
      employmentType: { not: "Supplied" },
      AND: [
        { OR: [{ status: { not: "Inactive" } }, { lastWorkingDay: { gte: start } }] },
        // Somebody who has not started yet is not on this month's payroll.
        // A missing join date must NOT filter them out, though: in SQL a
        // comparison against null is null, so "not after the month end" would
        // quietly drop them — and a man dropped by a query is never reported,
        // which is the failure this whole gate exists to end. Let them through
        // and let the readiness check name the missing date out loud.
        { OR: [{ joinDate: null }, { joinDate: { lte: end } }] },
      ],
    },
    include: { advances: { where: { status: "Active" }, orderBy: { createdAt: "asc" } } },
    orderBy: { empNo: "asc" },
  });
  if (employees.length === 0) return { ok: false, error: "No employees to pay for this month" };

  // The gate. A record that cannot produce a valid WPS line must not reach a
  // run: the bank rejects the whole file on one bad row and names none of them,
  // and a man quietly dropped from the file finds out on payday.
  const notReady = employees
    .map((e) => ({ e, problems: payrollReadiness(e, WPS_VALIDATORS) }))
    .filter((x) => x.problems.length);
  if (notReady.length) {
    return {
      ok: false,
      error:
        `${notReady.length === 1 ? "One employee is" : `${notReady.length} employees are`} not ready for payroll. ` +
        "Finish the record, or set them to Inactive if they should not be paid.",
      notReady: notReady.map((x) => `${x.e.name} (${x.e.empNo}) — ${x.problems.join(", ")}`),
    };
  }

  const ids = employees.map((e) => e.id);

  // Overtime comes off the muster, so nobody keys it twice.
  const attendance = await db.attendance.findMany({
    where: { employeeId: { in: ids }, date: { gte: start, lte: end } },
    select: { employeeId: true, status: true, otHours: true, otPremiumHours: true },
  });

  // The leave that costs pay: unpaid outright, and the part of sick leave that
  // falls past the full-pay band.
  const leave = await db.leaveRequest.findMany({
    where: {
      employeeId: { in: ids },
      status: "Approved",
      type: { in: ["Unpaid", "Sick"] },
      toDate: { gte: start },
    },
    select: { employeeId: true, type: true, fromDate: true, toDate: true, days: true },
  });

  const slips = employees.map((e) => {
    const mine = attendance.filter((a) => a.employeeId === e.id);
    const otHours = mine.reduce((t, a) => t + (a.otHours || 0), 0);
    const otPremiumHours = mine.reduce((t, a) => t + (a.otPremiumHours || 0), 0);
    const absentDays = mine.filter((a) => a.status === "Absent").length;

    const mineLeave = leave.filter((l) => l.employeeId === e.id);
    const unpaidLeaveDays = mineLeave
      .filter((l) => l.type === "Unpaid")
      .reduce((t, l) => t + overlapDays(l.fromDate, l.toDate, start, end), 0);

    // Sick pay depends on what has already gone this service year, so the
    // ladder is applied from where the year stands rather than from zero.
    const yearStart = serviceYearStart(e.joinDate, end);
    const sickBefore = mineLeave
      .filter((l) => l.type === "Sick" && l.fromDate >= yearStart && l.fromDate < start)
      .reduce((t, l) => t + l.days, 0);
    const sickNow = mineLeave
      .filter((l) => l.type === "Sick")
      .reduce((t, l) => t + overlapDays(l.fromDate, l.toDate, start, end), 0);
    const sickUnpaidDays = sickNow > 0 ? sickSplit(sickBefore, sickNow).unpaidEquivalent : 0;

    const adv = e.advances[0];
    const c = computePayslip({
      basic: e.basicSalary,
      allowances: e.allowances,
      periodStart: start,
      periodEnd: end,
      joinDate: e.joinDate,
      lastWorkingDay: e.lastWorkingDay,
      otHours,
      otPremiumHours,
      unpaidLeaveDays,
      sickUnpaidDays,
      absentDays,
      advanceRecovery: adv ? Math.min(adv.monthlyRecovery, adv.balance) : 0,
    });

    return {
      employeeId: e.id, empNo: e.empNo, employeeName: e.name,
      basic: toFils(c.basic), allowances: toFils(c.allowances),
      contractBasic: toFils(c.contractBasic), contractAllowances: toFils(c.contractAllowances),
      daysPaid: c.daysPaid, daysInPeriod: c.daysInPeriod,
      partMonthReason: c.partMonth ? c.reason : null,
      otHours: c.otHours, otPremiumHours: c.otPremiumHours, overtime: toFils(c.overtime),
      unpaidDays: c.unpaidDays, deductions: toFils(c.absenceDeduction),
      otherDeductions: 0, deductionNote: null,
      advanceRecovery: toFils(c.advanceRecovery), netPay: toFils(c.netPay),
    };
  });

  await db.payrollRun.create({
    data: { companyId, period, status: "Draft", runBy: session.user.name, payslips: { create: slips } },
  });
  const parts = slips.filter((x) => x.partMonthReason).length;
  await audit({
    action: "Created",
    entity: "PayrollRun",
    summary: `Ran payroll for ${period} (${employees.length} employees${parts ? `, ${parts} part month` : ""})`,
  });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

/**
 * Adjust one payslip while the run is still a draft.
 *
 * The only figure on a payslip a person should be keying: a fine, a recovery, a
 * correction agreed with the man. Everything else is derived, and when a
 * derived figure is wrong the fix belongs in the muster or the leave record,
 * not here — otherwise the payslip and the attendance stop agreeing and neither
 * can be trusted afterwards.
 */
export async function updatePayslip(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.payroll", "edit"))) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") || "");
  const slip = await db.payslip.findUnique({ where: { id }, include: { run: true } });
  if (!slip) return { ok: false, error: "Not found" };
  if (!(await scoped(slip.run.companyId))) return { ok: false, error: "No access" };
  if (slip.run.status !== "Draft") {
    return { ok: false, error: "This run has been approved. Set it back to Draft before changing a payslip." };
  }

  const other = toFils(Number(formData.get("otherDeductions")) || 0);
  if (other < 0) return { ok: false, error: "Enter the deduction as a positive amount" };
  const note = String(formData.get("deductionNote") || "").trim() || null;
  if (other > 0 && !note) {
    // A deduction nobody can explain is the one that becomes a labour claim.
    return { ok: false, error: "Say what the deduction is for — it has to be explainable a year from now." };
  }

  const gross = slip.basic + slip.allowances + slip.overtime;
  const netPay = toFils(Math.max(0, gross - slip.deductions - other - slip.advanceRecovery));

  await db.payslip.update({ where: { id }, data: { otherDeductions: other, deductionNote: note, netPay } });
  await audit({
    action: "Updated",
    entity: "Payslip",
    entityId: id,
    summary: `${slip.employeeName}: deduction ${money(other)}${note ? ` — ${note}` : ""}, net now ${money(netPay)}`,
  });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function setRunStatus(runId: string, status: string) {
  if (!(await allow("hr.payroll", "approve"))) return { ok: false as const, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not signed in" };
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run || !session.companies.some((c) => c.id === run.companyId)) return { ok: false as const, error: "Not found" };

  // On first transition to Paid: recover the advances, and put the month in
  // the books. Before this the accountant re-keyed a salary journal every
  // month from a printout, which is how the payroll and the ledger drift.
  if (status === "Paid" && run.status !== "Paid") {
    const posted = await postPayrollToLedger(runId, session.user.name);
    if (!posted.ok) return { ok: false, error: posted.error };

    const slips = await db.payslip.findMany({ where: { runId, advanceRecovery: { gt: 0 } } });
    for (const s of slips) {
      const adv = await db.advance.findFirst({ where: { employeeId: s.employeeId, status: "Active" }, orderBy: { createdAt: "asc" } });
      if (!adv) continue;
      const newBal = Math.max(0, Math.round((adv.balance - s.advanceRecovery) * 100) / 100);
      await db.advance.update({ where: { id: adv.id }, data: { balance: toFils(newBal), status: newBal <= 0 ? "Cleared" : "Active" } });
    }
  }

  // Once a run is in the ledger it cannot quietly go back to being a draft —
  // the voucher would still be there, and the two would disagree.
  if (status !== "Paid" && run.status === "Paid") {
    const voucher = await db.journalEntry.findFirst({
      where: { companyId: run.companyId, sourceType: "payroll", sourceId: runId },
    });
    if (voucher) {
      return {
        ok: false,
        error: `This run is posted to the ledger as ${voucher.reference}. Reverse that voucher in the Day Book first.`,
      };
    }
  }

  await db.payrollRun.update({ where: { id: runId }, data: { status } });
  await audit({ action: status === "Paid" ? "Posted" : "Updated", entity: "PayrollRun", entityId: runId, summary: `Payroll ${run.period} → ${status}` });
  revalidatePath("/hr/payroll");
  revalidatePath("/finance/daybook");
  return { ok: true as const };
}

/**
 * The month's wages, as one voucher.
 *
 *   Dr 6000 Salaries & Wages   what the month actually cost
 *   Cr 1000 Cash at Bank       what left the account
 *   Cr 1170 Employee Advances  what the staff paid back out of it
 *
 * The salary cost is gross less the absence and unpaid-leave deductions,
 * because those days were never earned — so the expense is what the company
 * owed, not what it would have owed had everybody turned up. The three lines
 * balance by construction: gross less deductions is net pay plus the advance
 * recovered, which is the same arithmetic the payslip does.
 *
 * One voucher per run, enforced by postVoucher's own uniqueness on the source
 * document, so approving twice cannot post twice.
 */
async function postPayrollToLedger(runId: string, postedBy: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { payslips: true } });
  if (!run) return { ok: false as const, error: "Run not found" };
  if (run.payslips.length === 0) return { ok: true as const };

  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: run.companyId, code: { in: [SALARY_EXPENSE_CODE, BANK_CODE, ADVANCE_CODE] } },
    select: { id: true, code: true },
  });
  const find = (code: string) => accounts.find((a) => a.code === code);
  const salary = find(SALARY_EXPENSE_CODE);
  const bank = find(BANK_CODE);
  const advances = find(ADVANCE_CODE);
  if (!salary || !bank) {
    return {
      ok: false as const,
      error: `This company needs accounts ${SALARY_EXPENSE_CODE} and ${BANK_CODE} before payroll can be posted. Add them under Ledgers.`,
    };
  }

  const net = round2(run.payslips.reduce((t, p) => t + p.netPay, 0));
  const recovered = round2(run.payslips.reduce((t, p) => t + p.advanceRecovery, 0));
  const cost = round2(net + recovered);
  if (cost <= 0) return { ok: true as const };

  if (recovered > 0 && !advances) {
    return {
      ok: false as const,
      error: `Advances were recovered this month, so this company needs account ${ADVANCE_CODE} Employee Advances. Add it under Ledgers.`,
    };
  }

  // The last day of the month the wages belong to, which is the date an
  // accountant expects the cost to fall on — not the day somebody clicked.
  const [y, m] = run.period.split("-").map(Number);
  const dateStr = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const lines: { accountId: string; debit: number; credit: number }[] = [
    { accountId: salary.id, debit: cost, credit: 0 },
    { accountId: bank.id, debit: 0, credit: net },
  ];
  if (recovered > 0 && advances) lines.push({ accountId: advances.id, debit: 0, credit: recovered });

  const res = await postVoucher({
    companyId: run.companyId,
    postedBy,
    voucherType: "Payment",
    date: dateStr,
    memo: `Payroll for ${run.period} — ${run.payslips.length} employee${run.payslips.length === 1 ? "" : "s"}`,
    lines,
    sourceType: "payroll",
    sourceId: runId,
    source: "payroll",
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, reference: res.reference };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export async function deletePayrollRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.payroll", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run || !session.companies.some((c) => c.id === run.companyId)) return { ok: false, error: "Not found" };
  if (run.status !== "Draft") return { ok: false, error: "Only draft runs can be deleted" };
  await db.payrollRun.delete({ where: { id: runId } });
  await audit({ action: "Deleted", entity: "PayrollRun", entityId: runId, summary: `Deleted draft payroll ${run.period}` });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

/* ---------------- Salary advances ---------------- */
export async function createAdvance(formData: FormData) {
  if (!(await allow("hr.payroll", "create"))) return;
  const companyId = String(formData.get("companyId") || "");
  if (!(await scoped(companyId))) return;
  const employeeId = String(formData.get("employeeId") || "");
  const emp = await db.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!emp) return;
  const amount = toFils(Number(formData.get("amount")) || 0);
  const monthlyRecovery = toFils(Number(formData.get("monthlyRecovery")) || 0);
  if (amount <= 0 || monthlyRecovery <= 0) return;
  await db.advance.create({
    data: { companyId, employeeId, employeeName: emp.name, amount, monthlyRecovery, balance: amount, reason: String(formData.get("reason") || "") || null },
  });
  await audit({ action: "Created", entity: "Employee", entityId: employeeId, summary: `Salary advance ${aed(amount)} to ${emp.name}` });
  revalidatePath("/hr/payroll");
}

export async function deleteAdvance(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.payroll", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const adv = await db.advance.findUnique({ where: { id } });
  if (!adv || !session.companies.some((c) => c.id === adv.companyId)) return { ok: false, error: "Not found" };
  await db.advance.delete({ where: { id } });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

/* ---------------- WPS employer config ---------------- */
export async function updateWpsConfig(formData: FormData) {
  if (!(await allow("hr.payroll", "edit"))) return;
  const companyId = String(formData.get("companyId") || "");
  const session = await scoped(companyId);
  if (!session) return;
  await db.company.update({
    where: { id: companyId },
    data: {
      wpsEmployerId: String(formData.get("wpsEmployerId") || "").trim() || null,
      wpsBankRouting: String(formData.get("wpsBankRouting") || "").trim() || null,
    },
  });
  revalidatePath("/hr/payroll");
}

/* ---------------- WPS SIF generation ---------------- */
export async function generateWpsSif(runId: string): Promise<{ ok: boolean; error?: string; content?: string; filename?: string; missing?: string[] }> {
  if (!(await allow("hr.payroll", "view"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { payslips: { orderBy: { empNo: "asc" } }, company: true } });
  if (!run || !session.companies.some((c) => c.id === run.companyId)) return { ok: false, error: "Not found" };
  if (!run.company.wpsEmployerId || !run.company.wpsBankRouting)
    return { ok: false, error: "Set the WPS employer ID and bank routing code first (below)." };

  const emps = await db.employee.findMany({
    where: { id: { in: run.payslips.map((p) => p.employeeId) } },
    select: { id: true, name: true, labourCardNo: true, iban: true, bankRoutingCode: true },
  });
  const byId = new Map(emps.map((e) => [e.id, e]));

  const lines: SifEmployee[] = [];
  const missing: string[] = [];
  for (const p of run.payslips) {
    const e = byId.get(p.employeeId);
    if (!e) { missing.push(`${p.employeeName} — no employee record`); continue; }

    // Present is not the same as valid. The bank rejects the entire file on one
    // bad row and names none of them, so anything malformed is held back here
    // with the reason, rather than sent and refused days later.
    const iban = cleanIban(e.iban ?? "");
    const card = cleanLabourCard(e.labourCardNo ?? "");
    const routing = cleanRouting(e.bankRoutingCode ?? "");
    const problems = [
      !e.iban ? "no IBAN" : iban.error,
      !e.labourCardNo ? "no labour-card number" : card.error,
      !e.bankRoutingCode ? "no bank routing code" : routing.error,
    ].filter(Boolean);
    if (problems.length) { missing.push(`${p.employeeName} — ${problems.join("; ")}`); continue; }

    const { fixed, variable } = splitFixedVariable(p.basic, p.netPay);
    // Days worked, not a flat thirty: the bank's file states what the man
    // was actually paid for, and a part month has to say so.
    lines.push({ personId: card.value!, routing: routing.value!, iban: iban.value!, fixed, variable, days: p.daysPaid || 30 });
  }
  if (lines.length === 0) {
    return { ok: false, error: "No employee has usable WPS details (labour-card no., IBAN, routing code).", missing };
  }

  const content = buildSif({ employerId: run.company.wpsEmployerId, routing: run.company.wpsBankRouting }, lines, run.period);
  const filename = `WPS_${run.company.code}_${run.period}.sif`;
  await audit({ action: "Posted", entity: "PayrollRun", entityId: runId, summary: `Generated WPS SIF for ${run.period} (${lines.length} employees)` });
  return { ok: true, content, filename, missing };
}

import { aed } from "@/lib/money";
import { toFils } from "@/lib/money";