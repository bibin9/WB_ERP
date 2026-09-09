"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { JOB_TYPES, JOB_STATUSES } from "@/lib/costing";
import { toFils } from "@/lib/money";

/**
 * Jobs — the contracts and projects the business is actually run by.
 *
 * BRD FIN-06. The question a managing director asks is "did we make money on
 * the ADNOC job?", and until costs and revenue carry a job there is no way to
 * answer it. Tagging happens on the voucher line, because one supplier invoice
 * routinely covers two jobs.
 */

// A "use server" module may only export async functions, so the vocabulary
// itself lives in @/lib/costing, where the forms can read it too.

function read(formData: FormData) {
  const num = (k: string) => toFils(Math.max(0, Number(formData.get(k)) || 0));
  const date = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00.000Z") : null;
  };
  const status = String(formData.get("status") || "Open");
  const type = String(formData.get("type") || "Contract");
  return {
    name: String(formData.get("name") || "").trim(),
    type: JOB_TYPES.includes(type as never) ? type : "Contract",
    parentId: String(formData.get("parentId") || "").trim() || null,
    partyId: String(formData.get("partyId") || "").trim() || null,
    contractValue: num("contractValue"),
    budgetCost: num("budgetCost"),
    budgetHours: num("budgetHours"),
    startDate: date("startDate"),
    endDate: date("endDate"),
    status: JOB_STATUSES.includes(status as never) ? status : "Open",
    notes: String(formData.get("notes") || "").trim() || null,
  };
}

/**
 * Walk up the tree to check a job is not about to become its own ancestor.
 *
 * Without this, setting A's parent to B while B's parent is A makes the costing
 * roll-up recurse forever, and the jobs screen simply stops loading. The depth
 * cap is a second belt: it also catches a cycle that already exists in data.
 */
async function wouldLoop(jobId: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  for (let hops = 0; cursor && hops < 20; hops++) {
    if (cursor === jobId) return true;
    const parent: { parentId: string | null } | null = await db.job.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
  return false;
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

  // A parent from another company would put one company's costs under another's
  // contract the moment the report rolls up.
  if (data.parentId && !(await db.job.findFirst({ where: { id: data.parentId, companyId } }))) {
    return { ok: false, error: "That parent job is not in this company" };
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
  if (data.parentId) {
    if (data.parentId === id) return { ok: false, error: "A job cannot be its own parent" };
    if (!(await db.job.findFirst({ where: { id: data.parentId, companyId: job.companyId } }))) {
      return { ok: false, error: "That parent job is not in this company" };
    }
    if (await wouldLoop(id, data.parentId)) {
      return { ok: false, error: "That would put the job inside one of its own sub-jobs" };
    }
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

  const job = await db.job.findUnique({
    where: { id },
    include: { _count: { select: { lines: true, children: true } } },
  });
  if (!job || !session.companies.some((c) => c.id === job.companyId)) return { ok: false, error: "Not found" };

  // Deleting a parent would silently detach its sub-jobs from the roll-up.
  if (job._count.children > 0) {
    return {
      ok: false,
      error: `${job.code} has ${job._count.children} sub-job${job._count.children === 1 ? "" : "s"} under it. Move or delete those first.`,
    };
  }

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
