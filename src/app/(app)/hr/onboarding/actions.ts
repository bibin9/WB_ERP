"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const CHECKLIST = ["Visa processing", "Emirates ID / residency", "Bank account setup", "HSE induction", "Issue assets (laptop/PPE)", "Collect certificates", "Sign contract"];

export async function createRequisition(formData: FormData) {
  const session = await getSession();
  if (!session) return;
  const companyId = String(formData.get("companyId") || "");
  const position = String(formData.get("position") || "").trim();
  if (!session.companies.some((c) => c.id === companyId) || !position) return;
  const created = await db.requisition.create({
    data: {
      companyId,
      position,
      department: String(formData.get("department") || "") || null,
      headcount: Number(formData.get("headcount")) || 1,
      raisedBy: session.user.name,
    },
  });
  await audit({ action: "Created", entity: "Requisition", entityId: created.id, summary: `Raised requisition: ${position}` });
  revalidatePath("/hr/onboarding");
}

export async function deleteRequisition(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const req = await db.requisition.findUnique({ where: { id } });
  if (!req || !session.companies.some((c) => c.id === req.companyId)) return { ok: false, error: "Not found" };
  await db.requisition.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Requisition", entityId: id, summary: `Deleted requisition: ${req.position}` });
  revalidatePath("/hr/onboarding");
  return { ok: true };
}

export async function addCandidate(formData: FormData) {
  const session = await getSession();
  if (!session) return;
  const requisitionId = String(formData.get("requisitionId") || "");
  const name = String(formData.get("name") || "").trim();
  const req = await db.requisition.findUnique({ where: { id: requisitionId } });
  if (!req || !session.companies.some((c) => c.id === req.companyId) || !name) return;
  await db.candidate.create({
    data: {
      requisitionId,
      name,
      email: String(formData.get("email") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      visaType: String(formData.get("visaType") || "") || null,
    },
  });
  if (req.status === "Open") await db.requisition.update({ where: { id: req.id }, data: { status: "Interviewing" } });
  revalidatePath("/hr/onboarding");
}

export async function setCandidateStage(id: string, stage: string) {
  const session = await getSession();
  if (!session) return;
  const cand = await db.candidate.findUnique({ where: { id }, include: { requisition: true } });
  if (!cand || !session.companies.some((c) => c.id === cand.requisition.companyId)) return;
  await db.candidate.update({ where: { id }, data: { stage } });
  revalidatePath("/hr/onboarding");
}

/** Hire a candidate → create an Employee + a standard onboarding checklist. */
export async function hireCandidate(id: string) {
  const session = await getSession();
  if (!session) return;
  const cand = await db.candidate.findUnique({ where: { id }, include: { requisition: true } });
  if (!cand || !session.companies.some((c) => c.id === cand.requisition.companyId)) return;
  const companyId = cand.requisition.companyId;

  const n = await db.employee.count({ where: { companyId } });
  const empNo = `EMP-${String(n + 1).padStart(4, "0")}`;
  const emp = await db.employee.create({
    data: {
      companyId, empNo, name: cand.name, email: cand.email, phone: cand.phone,
      designation: cand.requisition.position, department: cand.requisition.department,
      status: "Active",
      onboarding: { create: CHECKLIST.map((label, i) => ({ label, order: i + 1 })) },
    },
  });
  await db.candidate.update({ where: { id }, data: { stage: "Hired" } });
  await audit({ action: "Created", entity: "Employee", entityId: emp.id, summary: `Hired ${cand.name} as ${empNo} (onboarding started)` });
  revalidatePath("/hr/onboarding");
  revalidatePath("/hr");
}

export async function toggleOnboardingItem(id: string, done: boolean) {
  const session = await getSession();
  if (!session) return;
  const item = await db.onboardingItem.findUnique({ where: { id }, include: { employee: true } });
  if (!item || !session.companies.some((c) => c.id === item.employee.companyId)) return;
  await db.onboardingItem.update({ where: { id }, data: { done } });
  revalidatePath("/hr/onboarding");
}
