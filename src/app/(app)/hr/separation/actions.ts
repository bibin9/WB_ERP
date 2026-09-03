"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { computeSettlement, type SeparationType } from "@/lib/settlement";

const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

export async function createSeparation(formData: FormData) {
  const session = await getSession();
  if (!session || !can(session, "hr.separation", "create")) return;

  const employeeId = String(formData.get("employeeId") || "");
  const emp = await db.employee.findFirst({ where: { id: employeeId, companyId: { in: session.companies.map((c) => c.id) } } });
  if (!emp) return;

  const type = String(formData.get("type") || "Resignation") as SeparationType;
  const lastStr = String(formData.get("lastWorkingDay") || "");
  if (!lastStr) return;
  const lastWorkingDay = new Date(lastStr);

  const s = computeSettlement({
    basicSalary: emp.basicSalary,
    joinDate: emp.joinDate ?? emp.createdAt,
    lastWorkingDay,
    leaveBalanceDays: emp.annualLeaveBalance,
    separationType: type,
    forfeitGratuity: formData.get("forfeitGratuity") === "on",
    pendingSalary: num(formData, "pendingSalary"),
    noticePay: num(formData, "noticePay"),
    airTicket: num(formData, "airTicket"),
    otherAdditions: num(formData, "otherAdditions"),
    deductions: num(formData, "deductions"),
    adjustment: num(formData, "adjustment"),
  });

  await db.separation.create({
    data: {
      companyId: emp.companyId, employeeId: emp.id, type, lastWorkingDay,
      reason: String(formData.get("reason") || "") || null,
      basicSalary: emp.basicSalary,
      serviceText: s.service.text, serviceYears: Number(s.service.decimalYears.toFixed(3)),
      gratuityDays: s.gratuity.days, gratuityAmount: s.gratuity.amount,
      leaveDays: s.leaveDays, leaveAmount: s.leaveAmount,
      pendingSalary: s.pendingSalary, noticePay: s.noticePay, airTicket: s.airTicket,
      otherAdditions: s.otherAdditions, deductions: s.deductions,
      adjustment: s.adjustment, adjustmentNote: String(formData.get("adjustmentNote") || "") || null,
      netSettlement: s.netSettlement, status: "Draft", processedBy: session.user.name,
    },
  });

  // Employee has left — mark inactive.
  await db.employee.update({ where: { id: emp.id }, data: { status: "Inactive" } });
  await audit({ action: "Created", entity: "Employee", entityId: emp.id, summary: `${type} for ${emp.name}: net settlement AED ${s.netSettlement.toLocaleString()}` });
  revalidatePath("/hr/separation");
}

export async function setSeparationStatus(id: string, status: string) {
  const session = await getSession();
  if (!session || !can(session, "hr.separation", "edit")) return;
  const sep = await db.separation.findFirst({ where: { id, companyId: { in: session.companies.map((c) => c.id) } } });
  if (!sep) return;
  await db.separation.update({ where: { id }, data: { status } });
  await audit({ action: "Updated", entity: "Employee", entityId: sep.employeeId, summary: `Settlement ${sep.id} marked ${status}` });
  revalidatePath("/hr/separation");
}

export async function deleteSeparation(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !can(session, "hr.separation", "delete")) return { ok: false, error: "Not authorised" };
  const sep = await db.separation.findFirst({ where: { id, companyId: { in: session.companies.map((c) => c.id) } } });
  if (!sep) return { ok: false, error: "Not found" };
  await db.separation.delete({ where: { id } });
  // Reverse the employee deactivation (in case it was raised by mistake)
  await db.employee.update({ where: { id: sep.employeeId }, data: { status: "Active" } }).catch(() => {});
  await audit({ action: "Deleted", entity: "Employee", entityId: sep.employeeId, summary: `Removed settlement record ${sep.id}` });
  revalidatePath("/hr/separation");
  return { ok: true };
}
