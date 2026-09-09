"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

/**
 * The company's tax identity, and its address in parts.
 *
 * Neither is decoration. A tax invoice is invalid without the TRN, and a
 * transmitted eInvoice carries the emirate as a field of its own rather than
 * as part of a single address line.
 *
 * Both columns existed before this form did, which meant nothing could set
 * them and therefore no invoice could be issued at all.
 *
 * The TRN has its spaces and dashes taken out: people type it as it is
 * printed on the certificate, and the number on an invoice has to match the
 * one the FTA holds.
 */
function taxIdentityFrom(formData: FormData) {
  const text = (k: string, max = 120) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  return {
    vatTRN: String(formData.get("vatTRN") ?? "").replace(/[\s-]/g, "").trim() || null,
    addressLine: text("addressLine", 200),
    city: text("city", 80),
    emirate: text("emirate", 80),
  };
}

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
    data: { tenantId: session.tenant.id, code, name, baseCurrency, ...taxIdentityFrom(formData) },
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
/**
 * The company's letterhead, as a data URI or an https URL.
 *
 * Anything else is dropped rather than stored: a report is printed and sent
 * outside the business, and a src the browser will fetch is a src somebody else
 * chose. Size is capped because this sits in a row that is read on every report.
 */
function logoFrom(formData: FormData): string | null {
  const raw = String(formData.get("logoUrl") || "").trim();
  if (!raw) return null;
  const isImageData = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(raw);
  const isHttps = /^https:\/\/[^\s"'<>]+$/i.test(raw);
  if (!isImageData && !isHttps) return null;
  // Roughly 400 KB of base64. Larger than any letterhead needs to be.
  if (raw.length > 550_000) return null;
  return raw;
}

function financialYearFrom(formData: FormData): { fyStartMonth: number; openingAsOf: Date | null; booksLockedTo: Date | null } {
  const month = Number(formData.get("fyStartMonth"));
  const asOf = String(formData.get("openingAsOf") || "").trim();
  const locked = String(formData.get("booksLockedTo") || "").trim();
  return {
    fyStartMonth: month >= 1 && month <= 12 ? month : 1,
    openingAsOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(asOf + "T00:00:00.000Z") : null,
    booksLockedTo: /^\d{4}-\d{2}-\d{2}$/.test(locked) ? new Date(locked + "T23:59:59.999Z") : null,
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
  await db.company.update({
    where: { id },
    data: {
      name,
      baseCurrency,
      logoUrl: logoFrom(formData),
      // Which Emiratisation rule applies at 20–49 employees. Nothing on a
      // trade licence tells the system this, so somebody has to say.
      emiratisationSector: String(formData.get("emiratisationSector") || "") === "on",
      ...taxIdentityFrom(formData),
      ...financialYearFrom(formData),
    },
  });
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
