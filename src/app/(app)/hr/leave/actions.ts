"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

function daysBetween(from: string, to: string) {
  const a = new Date(from), b = new Date(to);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

export async function createLeaveRequest(formData: FormData) {
  if (!(await allow("hr.leave", "create"))) return;
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const employeeId = String(formData.get("employeeId") || "");
  const type = String(formData.get("type") || "Annual");
  const from = String(formData.get("fromDate") || "");
  const to = String(formData.get("toDate") || "");
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId) || !from || !to) return { ok: false, error: "Missing fields" };
  if (new Date(to) < new Date(from)) return { ok: false, error: "End date is before start date" };

  const days = daysBetween(from, to);
  await db.leaveRequest.create({
    data: {
      companyId: emp.companyId, employeeId, type, fromDate: new Date(from), toDate: new Date(to), days,
      reason: String(formData.get("reason") || "") || null,
    },
  });
  await audit({ action: "Created", entity: "LeaveRequest", summary: `${emp.name} requested ${days}d ${type} leave` });
  revalidatePath("/hr/leave");
  return { ok: true };
}

export async function decideLeaveRequest(id: string, decision: "Approved" | "Rejected") {
  if (!(await allow("hr.leave", "approve"))) return;
  const session = await getSession();
  if (!session) return;
  const lr = await db.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!lr || !session.companies.some((c) => c.id === lr.companyId) || lr.status !== "Pending") return;

  await db.leaveRequest.update({ where: { id }, data: { status: decision, decidedBy: session.user.name } });
  // On approval, deduct from the annual leave balance for paid annual leave
  if (decision === "Approved" && lr.type === "Annual") {
    await db.employee.update({ where: { id: lr.employeeId }, data: { annualLeaveBalance: { decrement: lr.days } } });
  }
  await audit({ action: decision, entity: "LeaveRequest", entityId: id, summary: `${decision} ${lr.days}d ${lr.type} for ${lr.employee.name}` });
  revalidatePath("/hr/leave");
}

export async function deleteLeaveRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.leave", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const lr = await db.leaveRequest.findUnique({ where: { id } });
  if (!lr || !session.companies.some((c) => c.id === lr.companyId)) return { ok: false, error: "Not found" };
  if (lr.status === "Approved" && lr.type === "Annual") {
    await db.employee.update({ where: { id: lr.employeeId }, data: { annualLeaveBalance: { increment: lr.days } } });
  }
  await db.leaveRequest.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "LeaveRequest", entityId: id, summary: `Deleted leave request` });
  revalidatePath("/hr/leave");
  return { ok: true };
}
