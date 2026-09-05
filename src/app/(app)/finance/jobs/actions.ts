"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";

/**
 * Jobs — the contracts and projects the business is actually run by.
 *
 * BRD FIN-06. The question a managing director asks is "did we make money on
 * the ADNOC job?", and until costs and revenue carry a job there is no way to
 * answer it. Tagging happens on the voucher line, because one supplier invoice
 * routinely covers two jobs.
 */

const STATUSES = ["Open", "On hold", "Completed", "Closed"];

function read(formData: FormData) {
  const num = (k: string) => Math.max(0, Number(formData.get(k)) || 0);
  const date = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00.000Z") : null;
  };
  const status = String(formData.get("status") || "Open");
  return {
    name: String(formData.get("name") || "").trim(),
    partyId: String(formData.get("partyId") || "").trim() || null,
    contractValue: num("contractValue"),
    budgetCost: num("budgetCost"),
    startDate: date("startDate"),
    endDate: date("endDate"),
    status: STATUSES.includes(status) ? status : "Open",
    notes: String(formData.get("notes") || "").trim() || null,
  };
}

/** Next code in the J-0001 series, per company. */
async function nextCode(companyId: string): Promise<string> {
  const n = await db.job.count({ where: { companyId } });
  return `J-${String(n + 1).padStart(4, "0")}`;
}

export async function createJob(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.jobs", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };

  const data = read(formData);
  if (!data.name) return { ok: false, error: "Give the job a name" };
  if (data.endDate && data.startDate && data.endDate < data.startDate) {
    return { ok: false, error: "The end date is before the start date" };
  }
  // A client from another company's list would silently break the job report.
  if (data.partyId && !(await db.party.findFirst({ where: { id: data.partyId, companyId } }))) {
    return { ok: false, error: "That customer is not in this company" };
  }

  const code = String(formData.get("code") || "").trim() || (await nextCode(companyId));
  if (await db.job.findUnique({ where: { companyId_code: { companyId, code } } })) {
    return { ok: false, error: `Job ${code} already exists` };
  }

  const created = await db.job.create({ data: { companyId, code, ...data } });
  await audit({ action: "Created", entity: "Job", entityId: created.id, summary: `Added job ${code} — ${data.name}` });
  revalidatePath("/finance/jobs");
  return { ok: true };
}

export async function updateJobRecord(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.jobs", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const id = String(formData.get("id") || "");
  const job = await db.job.findUnique({ where: { id } });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return { ok: false, error: "Not found" };

  const data = read(formData);
  if (!data.name) return { ok: false, error: "Give the job a name" };
  if (data.endDate && data.startDate && data.endDate < data.startDate) {
    return { ok: false, error: "The end date is before the start date" };
  }
  if (data.partyId && !(await db.party.findFirst({ where: { id: data.partyId, companyId: job.companyId } }))) {
    return { ok: false, error: "That customer is not in this company" };
  }

  await db.job.update({ where: { id }, data });
  await audit({ action: "Updated", entity: "Job", entityId: id, summary: `Updated job ${job.code} — ${data.name}` });
  revalidatePath("/finance/jobs");
  return { ok: true };
}

export async function deleteJob(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.jobs", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const job = await db.job.findUnique({ where: { id }, include: { _count: { select: { lines: true } } } });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return { ok: false, error: "Not found" };

  // Deleting a job that has been posted against would orphan the costing.
  if (job._count.lines > 0) {
    return {
      ok: false,
      error: `${job.code} has ${job._count.lines} posting${job._count.lines === 1 ? "" : "s"} against it. Set it to Closed instead.`,
    };
  }

  await db.job.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Job", entityId: id, summary: `Deleted job ${job.code}` });
  revalidatePath("/finance/jobs");
  return { ok: true };
}
