"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildSif, splitFixedVariable, type SifEmployee } from "@/lib/wps";
import { allow } from "@/lib/guard";
import { cleanIban, cleanLabourCard, cleanRouting } from "@/lib/uae";
import { computePayslip, payrollReadiness, sickSplit } from "@/lib/payroll";
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
  if (!(await allow("hr.payroll", "approve"))) return;
  const session = await getSession();
  if (!session) return;
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run || !session.companies.some((c) => c.id === run.companyId)) return;

  // On first transition to Paid, recover advance installments from balances.
  if (status === "Paid" && run.status !== "Paid") {
    const slips = await db.payslip.findMany({ where: { runId, advanceRecovery: { gt: 0 } } });
    for (const s of slips) {
      const adv = await db.advance.findFirst({ where: { employeeId: s.employeeId, status: "Active" }, orderBy: { createdAt: "asc" } });
      if (!adv) continue;
      const newBal = Math.max(0, Math.round((adv.balance - s.advanceRecovery) * 100) / 100);
      await db.advance.update({ where: { id: adv.id }, data: { balance: toFils(newBal), status: newBal <= 0 ? "Cleared" : "Active" } });
    }
  }
  await db.payrollRun.update({ where: { id: runId }, data: { status } });
  await audit({ action: status === "Paid" ? "Posted" : "Updated", entity: "PayrollRun", entityId: runId, summary: `Payroll ${run.period} → ${status}` });
  revalidatePath("/hr/payroll");
}

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