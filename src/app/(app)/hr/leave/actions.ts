"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";
import { leaveBalance, canBook } from "@/lib/leave";

/**
 * What somebody has actually earned, today.
 *
 * Worked out from the join date and the leave already approved, never read
 * off a stored number — a stored balance drifts from the record it is meant
 * to summarise, and the figure it drifts into is the one the final
 * settlement pays out in cash.
 */
async function balanceFor(employeeId: string) {
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return null;
  const taken = await db.leaveRequest.aggregate({
    where: { employeeId, type: "Annual", status: "Approved" },
    _sum: { days: true },
  });
  return leaveBalance(emp.joinDate, new Date(), taken._sum.days ?? 0, emp.annualLeaveBalance);
}

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

  // Annual leave has to have been earned. Sick leave has its own entitlement,
  // unpaid leave is unpaid by definition, and time off in lieu was worked for.
  const bal = await balanceFor(employeeId);
  if (bal) {
    const check = canBook(type, days, bal);
    if (!check.ok) return { ok: false, error: check.note };
  }

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

  // Approving somebody past their balance is how a balance goes negative and
  // stays there. The request may have been raised when there were days left.
  if (decision === "Approved" && lr.type === "Annual") {
    const bal = await balanceFor(lr.employeeId);
    if (bal) {
      const check = canBook("Annual", lr.days, bal);
      if (!check.ok) return { ok: false, error: check.note };
    }
  }

  await db.leaveRequest.update({ where: { id }, data: { status: decision, decidedBy: session.user.name } });
  // Nothing is decremented: the balance is derived from the approved requests
  // themselves, so approving one moves it by definition.
  await audit({ action: decision, entity: "LeaveRequest", entityId: id, summary: `${decision} ${lr.days}d ${lr.type} for ${lr.employee.name}` });
  revalidatePath("/hr/leave");
}

export async function deleteLeaveRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("hr.leave", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const lr = await db.leaveRequest.findUnique({ where: { id } });
  if (!lr || !session.companies.some((c) => c.id === lr.companyId)) return { ok: false, error: "Not found" };
  // Deleting an approved request gives the days back on its own, because the
  // balance counts approved requests rather than tracking a separate number.
  await db.leaveRequest.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "LeaveRequest", entityId: id, summary: `Deleted leave request` });
  revalidatePath("/hr/leave");
  return { ok: true };
}
