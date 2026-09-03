"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function createPayrollRun(formData: FormData) {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const companyId = String(formData.get("companyId") || "");
  const period = String(formData.get("period") || "").trim(); // YYYY-MM
  if (!session.companies.some((c) => c.id === companyId) || !/^\d{4}-\d{2}$/.test(period))
    return { ok: false, error: "Pick a valid month" };

  const existing = await db.payrollRun.findUnique({ where: { companyId_period: { companyId, period } } });
  if (existing) return { ok: false, error: "Payroll already run for this month" };

  const employees = await db.employee.findMany({ where: { companyId, status: { not: "Inactive" } } });
  if (employees.length === 0) return { ok: false, error: "No active employees to pay" };

  await db.payrollRun.create({
    data: {
      companyId,
      period,
      status: "Draft",
      runBy: session.user.name,
      payslips: {
        create: employees.map((e) => ({
          employeeId: e.id,
          empNo: e.empNo,
          employeeName: e.name,
          basic: e.basicSalary,
          allowances: e.allowances,
          deductions: 0,
          netPay: e.basicSalary + e.allowances,
        })),
      },
    },
  });
  await audit({ action: "Created", entity: "PayrollRun", summary: `Ran payroll for ${period} (${employees.length} employees)` });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function setRunStatus(runId: string, status: string) {
  const session = await getSession();
  if (!session) return;
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run || !session.companies.some((c) => c.id === run.companyId)) return;
  await db.payrollRun.update({ where: { id: runId }, data: { status } });
  await audit({ action: status === "Paid" ? "Posted" : "Updated", entity: "PayrollRun", entityId: runId, summary: `Payroll ${run.period} → ${status}` });
  revalidatePath("/hr/payroll");
}

export async function deletePayrollRun(runId: string): Promise<{ ok: boolean; error?: string }> {
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
