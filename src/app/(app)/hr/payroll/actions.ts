"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildSif, splitFixedVariable, type SifEmployee } from "@/lib/wps";
import { allow } from "@/lib/guard";

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

  const employees = await db.employee.findMany({
    where: { companyId, status: { not: "Inactive" } },
    include: { advances: { where: { status: "Active" }, orderBy: { createdAt: "asc" } } },
  });
  if (employees.length === 0) return { ok: false, error: "No active employees to pay" };

  await db.payrollRun.create({
    data: {
      companyId, period, status: "Draft", runBy: session.user.name,
      payslips: {
        create: employees.map((e) => {
          const adv = e.advances[0];
          const advanceRecovery = adv ? Math.min(adv.monthlyRecovery, adv.balance) : 0;
          const netPay = e.basicSalary + e.allowances - advanceRecovery;
          return { employeeId: e.id, empNo: e.empNo, employeeName: e.name, basic: e.basicSalary, allowances: e.allowances, deductions: 0, advanceRecovery, netPay };
        }),
      },
    },
  });
  await audit({ action: "Created", entity: "PayrollRun", summary: `Ran payroll for ${period} (${employees.length} employees)` });
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
      await db.advance.update({ where: { id: adv.id }, data: { balance: newBal, status: newBal <= 0 ? "Cleared" : "Active" } });
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
  const amount = Number(formData.get("amount")) || 0;
  const monthlyRecovery = Number(formData.get("monthlyRecovery")) || 0;
  if (amount <= 0 || monthlyRecovery <= 0) return;
  await db.advance.create({
    data: { companyId, employeeId, employeeName: emp.name, amount, monthlyRecovery, balance: amount, reason: String(formData.get("reason") || "") || null },
  });
  await audit({ action: "Created", entity: "Employee", entityId: employeeId, summary: `Salary advance AED ${amount.toLocaleString()} to ${emp.name}` });
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
    if (!e || !e.labourCardNo || !e.iban || !e.bankRoutingCode) { missing.push(p.employeeName); continue; }
    const { fixed, variable } = splitFixedVariable(p.basic, p.netPay);
    lines.push({ personId: e.labourCardNo, routing: e.bankRoutingCode, iban: e.iban, fixed, variable, days: 30 });
  }
  if (lines.length === 0) return { ok: false, error: "No employees have complete WPS details (labour-card no., IBAN, routing code).", missing };

  const content = buildSif({ employerId: run.company.wpsEmployerId, routing: run.company.wpsBankRouting }, lines, run.period);
  const filename = `WPS_${run.company.code}_${run.period}.sif`;
  await audit({ action: "Posted", entity: "PayrollRun", entityId: runId, summary: `Generated WPS SIF for ${run.period} (${lines.length} employees)` });
  return { ok: true, content, filename, missing };
}
