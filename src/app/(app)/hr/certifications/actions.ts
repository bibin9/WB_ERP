"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

async function empInScope(employeeId: string) {
  const session = await getSession();
  if (!session) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return null;
  return emp;
}

export async function addCertification(formData: FormData) {
  if (!(await allow("hr.certifications", "create"))) return;
  const employeeId = String(formData.get("employeeId") || "");
  const name = String(formData.get("name") || "").trim();
  const emp = await empInScope(employeeId);
  if (!emp || !name) return;
  const issue = String(formData.get("issueDate") || "");
  const expiry = String(formData.get("expiryDate") || "");
  const created = await db.certification.create({
    data: {
      companyId: emp.companyId, employeeId, name,
      category: String(formData.get("category") || "Competency"),
      issuedBy: String(formData.get("issuedBy") || "") || null,
      issueDate: issue ? new Date(issue) : null,
      expiryDate: expiry ? new Date(expiry) : null,
      notes: String(formData.get("notes") || "") || null,
    },
  });
  await audit({ action: "Created", entity: "Certification", entityId: created.id, summary: `${emp.name}: ${name}` });
  revalidatePath("/hr/certifications");
}

export async function deleteCertification(id: string) {
  if (!(await allow("hr.certifications", "delete"))) return;
  const session = await getSession();
  if (!session) return;
  const c = await db.certification.findUnique({ where: { id } });
  if (!c || !session.companies.some((x) => x.id === c.companyId)) return;
  await db.certification.delete({ where: { id } });
  revalidatePath("/hr/certifications");
}

export async function addAppraisal(formData: FormData) {
  if (!(await allow("hr.certifications", "create"))) return;
  const session = await getSession();
  if (!session) return;
  const employeeId = String(formData.get("employeeId") || "");
  const emp = await empInScope(employeeId);
  const period = String(formData.get("period") || "").trim();
  const rating = Number(formData.get("rating")) || 0;
  if (!emp || !period || rating < 1 || rating > 5) return;
  await db.appraisal.create({
    data: {
      companyId: emp.companyId, employeeId, period, rating,
      goals: String(formData.get("goals") || "") || null,
      feedback: String(formData.get("feedback") || "") || null,
      reviewedBy: session.user.name,
    },
  });
  await audit({ action: "Created", entity: "Appraisal", summary: `Appraisal ${period} for ${emp.name} (${rating}/5)` });
  revalidatePath("/hr/certifications");
}

export async function deleteAppraisal(id: string) {
  if (!(await allow("hr.certifications", "delete"))) return;
  const session = await getSession();
  if (!session) return;
  const a = await db.appraisal.findUnique({ where: { id } });
  if (!a || !session.companies.some((x) => x.id === a.companyId)) return;
  await db.appraisal.delete({ where: { id } });
  revalidatePath("/hr/certifications");
}
