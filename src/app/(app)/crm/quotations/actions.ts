"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import {
  createQuotation, submitQuotation, withdrawQuotation, issueQuotation,
  reviseQuotation, acceptQuotation, declineQuotation,
} from "@/lib/quote-posting";

export type Result = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;
const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  return session.companies.some((c) => c.id === companyId) ? session : null;
}

async function companyOf(quotationId: string) {
  const q = await db.quotation.findUnique({ where: { id: quotationId }, select: { companyId: true } });
  return q?.companyId ?? "";
}

const refresh = (id: string) => {
  revalidatePath(`/crm/quotations/${id}`);
  revalidatePath("/crm/quotations");
  revalidatePath("/crm");
};

export async function saveQuotation(formData: FormData): Promise<Result> {
  if (!(await allow("crm.quotations", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const res = await createQuotation({
    companyId,
    preparedBy: session.user.name,
    estimateId: str(formData, "estimateId"),
    title: orNull(formData, "title", 300),
    customerName: orNull(formData, "customerName"),
    validUntil: orNull(formData, "validUntil", 10),
    terms: orNull(formData, "terms", 2000),
    notes: orNull(formData, "notes", 1000),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created", entity: "Quotation", entityId: res.quotationId,
    summary: `Raised quotation ${res.number} at ${res.total}`,
  });
  revalidatePath("/crm/quotations");
  return { ok: true };
}

export async function sendForApproval(quotationId: string): Promise<Result> {
  if (!(await allow("crm.quotations", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await scoped(await companyOf(quotationId));
  if (!session) return { ok: false, error: "No access" };

  const res = await submitQuotation(quotationId, session.tenant.id, session.user.name);
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "Quotation", entityId: quotationId, summary: "Sent for approval" });
  refresh(quotationId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function pullBack(quotationId: string): Promise<Result> {
  if (!(await allow("crm.quotations", "edit"))) return { ok: false, error: "Not authorised" };
  if (!(await scoped(await companyOf(quotationId)))) return { ok: false, error: "No access" };

  const res = await withdrawQuotation(quotationId);
  if (!res.ok) return res;
  await audit({ action: "Updated", entity: "Quotation", entityId: quotationId, summary: "Pulled back from approval" });
  refresh(quotationId);
  return { ok: true };
}

export async function issue(formData: FormData): Promise<Result> {
  if (!(await allow("crm.quotations", "approve"))) return { ok: false, error: "Not authorised" };
  const quotationId = str(formData, "quotationId");
  const session = await scoped(await companyOf(quotationId));
  if (!session) return { ok: false, error: "No access" };

  const res = await issueQuotation({
    quotationId,
    issuedTo: str(formData, "issuedTo"),
    by: session.user.name,
  });
  if (!res.ok) return res;

  await audit({
    action: "Updated", entity: "Quotation", entityId: quotationId,
    summary: `Issued to ${str(formData, "issuedTo")}`,
  });
  refresh(quotationId);
  return { ok: true };
}

export async function revise(quotationId: string): Promise<Result> {
  if (!(await allow("crm.quotations", "create"))) return { ok: false, error: "Not authorised" };
  const session = await scoped(await companyOf(quotationId));
  if (!session) return { ok: false, error: "No access" };

  const res = await reviseQuotation(quotationId, session.user.name);
  if (!res.ok) return res;

  await audit({
    action: "Created", entity: "Quotation", entityId: res.quotationId,
    summary: `Raised ${res.number} as a revision`,
  });
  refresh(quotationId);
  return { ok: true };
}

export async function accept(formData: FormData): Promise<Result> {
  if (!(await allow("crm.quotations", "approve"))) return { ok: false, error: "Not authorised" };
  const quotationId = str(formData, "quotationId");
  const session = await scoped(await companyOf(quotationId));
  if (!session) return { ok: false, error: "No access" };

  const res = await acceptQuotation({
    quotationId,
    poNumber: str(formData, "poNumber", 100),
    poDate: str(formData, "poDate", 10),
    poValue: num(formData, "poValue"),
    poRef: orNull(formData, "poRef", 300),
    acknowledged: str(formData, "acknowledged") === "on",
    jobCode: orNull(formData, "jobCode", 40),
    by: session.user.name,
  });
  if (!res.ok) return res;

  await audit({
    action: "Approved", entity: "Quotation", entityId: quotationId,
    summary:
      `Customer order ${str(formData, "poNumber", 100)} recorded, job ${res.jobCode} created` +
      (res.variance.matches ? "" : ` (${res.variance.difference > 0 ? "+" : ""}${res.variance.difference} against the quote)`),
  });
  refresh(quotationId);
  revalidatePath("/finance/jobs");
  return { ok: true };
}

export async function decline(formData: FormData): Promise<Result> {
  if (!(await allow("crm.quotations", "edit"))) return { ok: false, error: "Not authorised" };
  const quotationId = str(formData, "quotationId");
  const session = await scoped(await companyOf(quotationId));
  if (!session) return { ok: false, error: "No access" };

  const res = await declineQuotation({
    quotationId,
    reason: str(formData, "reason", 500),
    by: session.user.name,
  });
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "Quotation", entityId: quotationId, summary: "Customer declined it" });
  refresh(quotationId);
  return { ok: true };
}
