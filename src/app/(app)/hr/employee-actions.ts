"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

async function nextEmpNo(companyId: string): Promise<string> {
  const n = await db.employee.count({ where: { companyId } });
  return `EMP-${String(n + 1).padStart(4, "0")}`;
}

export async function createEmployee(formData: FormData) {
  const session = await getSession();
  if (!session) return;

  const companyId = String(formData.get("companyId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!session.companies.some((c) => c.id === companyId) || !name) return;

  const empNo = await nextEmpNo(companyId);
  const created = await db.employee.create({
    data: {
      companyId,
      empNo,
      name,
      email: String(formData.get("email") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      department: String(formData.get("department") || "") || null,
      designation: String(formData.get("designation") || "") || null,
      grade: String(formData.get("grade") || "") || null,
      employmentType: String(formData.get("employmentType") || "Full-time"),
      supplier: String(formData.get("supplier") || "") || null,
      basicSalary: Number(formData.get("basicSalary")) || 0,
      allowances: Number(formData.get("allowances")) || 0,
    },
  });
  await audit({ action: "Created", entity: "Employee", entityId: created.id, summary: `Added employee ${empNo} — ${name}` });
  revalidatePath("/hr");
}

export async function setEmployeeStatus(id: string, status: string) {
  const session = await getSession();
  if (!session) return;
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return;
  await db.employee.update({ where: { id }, data: { status } });
  await audit({ action: "Updated", entity: "Employee", entityId: id, summary: `Set ${emp.empNo} status to ${status}` });
  revalidatePath("/hr");
}

export async function updateEmployee(formData: FormData) {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") || "");
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return;
  const name = String(formData.get("name") || "").trim();
  if (!name) return;

  await db.employee.update({
    where: { id },
    data: {
      name,
      email: String(formData.get("email") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      department: String(formData.get("department") || "") || null,
      designation: String(formData.get("designation") || "") || null,
      grade: String(formData.get("grade") || "") || null,
      employmentType: String(formData.get("employmentType") || "Full-time"),
      supplier: String(formData.get("supplier") || "") || null,
      basicSalary: Number(formData.get("basicSalary")) || 0,
      allowances: Number(formData.get("allowances")) || 0,
    },
  });
  await audit({ action: "Updated", entity: "Employee", entityId: id, summary: `Updated employee ${emp.empNo} — ${name}` });
  revalidatePath("/hr");
}

export async function deleteEmployee(id: string) {
  const session = await getSession();
  if (!session) return;
  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp || !session.companies.some((c) => c.id === emp.companyId)) return;
  await db.employee.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Employee", entityId: id, summary: `Deleted employee ${emp.empNo} — ${emp.name}` });
  revalidatePath("/hr");
}
