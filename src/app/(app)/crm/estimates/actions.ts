"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import {
  createEstimate, saveLine, removeLine, saveTakeoff, removeTakeoff, setBasis, markPriced,
} from "@/lib/estimate-posting";

/**
 * Estimate actions. Every one reads a form and hands it to
 * lib/estimate-posting, where the rules are.
 */

export type Result = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;
const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

/**
 * A percentage the way people type it, as the fraction the rules use.
 *
 * Estimators write 20 and mean a fifth. Storing 20 would make it two thousand
 * per cent, so the conversion happens once, here, rather than in each form.
 */
const fraction = (fd: FormData, k: string) => (Number(fd.get(k)) || 0) / 100;

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  return session.companies.some((c) => c.id === companyId) ? session : null;
}

async function companyOfEstimate(estimateId: string) {
  const e = await db.estimate.findUnique({ where: { id: estimateId }, select: { companyId: true } });
  return e?.companyId ?? "";
}

export async function saveEstimate(formData: FormData): Promise<Result> {
  if (!(await allow("crm.estimates", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const res = await createEstimate({
    companyId,
    preparedBy: session.user.name,
    title: str(formData, "title", 300),
    leadId: orNull(formData, "leadId"),
    overheadPct: fraction(formData, "overheadPct"),
    fixedCosts: num(formData, "fixedCosts"),
    basisKind: str(formData, "basisKind", 20),
    basisValue: fraction(formData, "basisValue"),
    notes: orNull(formData, "notes", 1000),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created", entity: "Estimate", entityId: res.estimateId,
    summary: `Started estimate ${res.number}`,
  });
  revalidatePath("/crm/estimates");
  return { ok: true };
}

export async function saveEstimateLine(formData: FormData): Promise<Result> {
  if (!(await allow("crm.estimates", "edit"))) return { ok: false, error: "Not authorised" };
  const estimateId = str(formData, "estimateId");
  if (!(await scoped(await companyOfEstimate(estimateId)))) return { ok: false, error: "No access" };

  const res = await saveLine({
    estimateId,
    id: orNull(formData, "id"),
    ref: orNull(formData, "ref", 40),
    description: str(formData, "description", 500),
    unit: str(formData, "unit", 30),
    quantity: num(formData, "quantity"),
    materialCost: num(formData, "materialCost"),
    labourHours: num(formData, "labourHours"),
    labourRate: num(formData, "labourRate"),
    plantHours: num(formData, "plantHours"),
    plantRate: num(formData, "plantRate"),
    subcontractCost: num(formData, "subcontractCost"),
    notes: orNull(formData, "notes", 500),
  });
  if (!res.ok) return res;

  revalidatePath(`/crm/estimates/${estimateId}`);
  revalidatePath("/crm/estimates");
  return { ok: true };
}

export async function deleteEstimateLine(lineId: string): Promise<Result> {
  if (!(await allow("crm.estimates", "delete"))) return { ok: false, error: "Not authorised" };
  const line = await db.estimateLine.findUnique({ where: { id: lineId }, select: { estimateId: true } });
  if (!line) return { ok: false, error: "Not found" };
  if (!(await scoped(await companyOfEstimate(line.estimateId)))) return { ok: false, error: "No access" };

  const res = await removeLine(lineId);
  if (!res.ok) return res;
  revalidatePath(`/crm/estimates/${line.estimateId}`);
  return { ok: true };
}

export async function saveTakeoffLine(formData: FormData): Promise<Result> {
  if (!(await allow("crm.estimates", "edit"))) return { ok: false, error: "Not authorised" };
  const lineId = str(formData, "lineId");
  const line = await db.estimateLine.findUnique({ where: { id: lineId }, select: { estimateId: true } });
  if (!line) return { ok: false, error: "Not found" };
  if (!(await scoped(await companyOfEstimate(line.estimateId)))) return { ok: false, error: "No access" };

  const res = await saveTakeoff({
    lineId,
    id: orNull(formData, "id"),
    itemId: orNull(formData, "itemId"),
    description: str(formData, "description", 300),
    unitCode: str(formData, "unitCode", 8) || "EA",
    perUnit: num(formData, "perUnit"),
    wastage: fraction(formData, "wastage"),
    unitCost: num(formData, "unitCost"),
  });
  if (!res.ok) return res;

  revalidatePath(`/crm/estimates/${line.estimateId}`);
  return { ok: true };
}

export async function deleteTakeoffLine(takeoffId: string): Promise<Result> {
  if (!(await allow("crm.estimates", "delete"))) return { ok: false, error: "Not authorised" };
  const t = await db.takeoffLine.findUnique({
    where: { id: takeoffId },
    select: { line: { select: { estimateId: true } } },
  });
  if (!t) return { ok: false, error: "Not found" };
  if (!(await scoped(await companyOfEstimate(t.line.estimateId)))) return { ok: false, error: "No access" };

  const res = await removeTakeoff(takeoffId);
  if (!res.ok) return res;
  revalidatePath(`/crm/estimates/${t.line.estimateId}`);
  return { ok: true };
}

export async function setEstimateBasis(formData: FormData): Promise<Result> {
  if (!(await allow("crm.estimates", "edit"))) return { ok: false, error: "Not authorised" };
  const estimateId = str(formData, "estimateId");
  if (!(await scoped(await companyOfEstimate(estimateId)))) return { ok: false, error: "No access" };

  const res = await setBasis({
    estimateId,
    overheadPct: fraction(formData, "overheadPct"),
    fixedCosts: num(formData, "fixedCosts"),
    basisKind: str(formData, "basisKind", 20),
    basisValue: fraction(formData, "basisValue"),
    acceptLoss: str(formData, "acceptLoss") === "on",
  });
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "Estimate", entityId: estimateId, summary: "Changed the pricing basis" });
  revalidatePath(`/crm/estimates/${estimateId}`);
  revalidatePath("/crm/estimates");
  return { ok: true };
}

export async function finishEstimate(estimateId: string): Promise<Result> {
  if (!(await allow("crm.estimates", "edit"))) return { ok: false, error: "Not authorised" };
  if (!(await scoped(await companyOfEstimate(estimateId)))) return { ok: false, error: "No access" };

  const res = await markPriced(estimateId);
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "Estimate", entityId: estimateId, summary: "Marked the estimate priced" });
  revalidatePath(`/crm/estimates/${estimateId}`);
  revalidatePath("/crm/estimates");
  return { ok: true };
}
