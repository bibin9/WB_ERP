"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

export async function createCompany(formData: FormData) {
  if (!(await allow("companies.list", "create"))) return;
  const session = await getSession();
  if (!session || !(await canAdminister())) return;

  const code = String(formData.get("code") || "").trim().toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const baseCurrency = String(formData.get("baseCurrency") || "AED").trim().toUpperCase() || "AED";
  if (!code || !name) return;

  const exists = await db.company.findUnique({
    where: { tenantId_code: { tenantId: session.tenant.id, code } },
  });
  if (exists) return;

  const created = await db.company.create({
    data: { tenantId: session.tenant.id, code, name, baseCurrency },
  });
  await audit({ action: "Created", entity: "Company", entityId: created.id, summary: `Added company ${code} — ${name}` });
  revalidatePath("/companies");
  revalidatePath("/dashboard");
}

export async function toggleCompanyActive(id: string, next: boolean) {
  if (!(await allow("companies.list", "edit"))) return;
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const company = await db.company.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!company) return;
  await db.company.update({ where: { id }, data: { isActive: next } });
  await audit({ action: "Updated", entity: "Company", entityId: id, summary: `${next ? "Activated" : "Deactivated"} company ${company.code}` });
  revalidatePath("/companies");
}

/** Financial-year start and the date opening balances are stated as at. */
function financialYearFrom(formData: FormData): { fyStartMonth: number; openingAsOf: Date | null } {
  const month = Number(formData.get("fyStartMonth"));
  const asOf = String(formData.get("openingAsOf") || "").trim();
  return {
    fyStartMonth: month >= 1 && month <= 12 ? month : 1,
    openingAsOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(asOf + "T00:00:00.000Z") : null,
  };
}

export async function updateCompany(formData: FormData) {
  if (!(await allow("companies.list", "edit"))) return;
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const id = String(formData.get("id") || "");
  const company = await db.company.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!company) return;
  const name = String(formData.get("name") || "").trim();
  const baseCurrency = (String(formData.get("baseCurrency") || "AED").trim().toUpperCase()) || "AED";
  if (!name) return;
  await db.company.update({ where: { id }, data: { name, baseCurrency, ...financialYearFrom(formData) } });
  await audit({ action: "Updated", entity: "Company", entityId: id, summary: `Updated company ${company.code} — ${name}` });
  revalidatePath("/companies");
}

export async function deleteCompany(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("companies.list", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session || !(await canAdminister())) return { ok: false, error: "Not authorised" };
  const company = await db.company.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!company) return { ok: false, error: "Not found" };

  // Guard: don't delete a company that holds transactions — deactivate instead
  const [emps, journals, reqs] = await Promise.all([
    db.employee.count({ where: { companyId: id } }),
    db.journalEntry.count({ where: { companyId: id } }),
    db.approvalRequest.count({ where: { companyId: id } }),
  ]);
  if (emps + journals + reqs > 0) {
    return { ok: false, error: "Has records — deactivate instead" };
  }
  await db.company.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Company", entityId: id, summary: `Deleted company ${company.code} — ${company.name}` });
  revalidatePath("/companies");
  return { ok: true };
}
