"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { toFils, money } from "@/lib/money";
import { cleanTrn } from "@/lib/uae";
import {
  ADJUSTMENT_KINDS, CATEGORY_KEYS, categoryKind, compute, dueDate,
} from "@/lib/corporatetax";
import { profitAndLoss } from "@/lib/ledger-query";

/**
 * The corporate tax working paper.
 *
 * Nothing here posts to the ledger, and that is deliberate. Corporate tax is
 * charged on a period that is not closed until well after it ends: the return
 * is due nine months later, and the figure moves as adjustments are agreed. A
 * provision that posted itself every time somebody typed a number would rewrite
 * the accounts the return is computed from — the tail wagging the dog.
 *
 * So the computation reads the books and never writes to them. When the return
 * is filed and the liability is real, it goes in as a journal like any other
 * accrual, and the reference is recorded here so the two can be tied together.
 */

type Result = { ok: boolean; error?: string; id?: string };

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  if (!session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

const asDate = (v: FormDataEntryValue | null) => {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00.000Z") : null;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Every company files its own return, so a period is opened per company. */
export async function openReturn(formData: FormData): Promise<Result> {
  if (!(await allow("finance.corptax", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = String(formData.get("companyId") || "");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const periodFrom = asDate(formData.get("periodFrom"));
  const periodTo = asDate(formData.get("periodTo"));
  if (!periodFrom || !periodTo) return { ok: false, error: "Enter the start and end of the tax period" };
  if (periodTo <= periodFrom) return { ok: false, error: "The period must end after it starts" };

  // A tax period cannot exceed a financial year. Anything longer is two
  // periods, and filing them as one would be wrong.
  const months = (periodTo.getUTCFullYear() - periodFrom.getUTCFullYear()) * 12
    + (periodTo.getUTCMonth() - periodFrom.getUTCMonth());
  if (months > 12) return { ok: false, error: "A tax period cannot be longer than twelve months. Open two returns instead." };

  const clash = await db.corporateTaxReturn.findFirst({
    where: { companyId, periodFrom, periodTo },
  });
  if (clash) return { ok: false, error: "That period is already open for this company." };

  // Overlapping periods would double-count the same profit.
  const overlap = await db.corporateTaxReturn.findFirst({
    where: { companyId, periodFrom: { lte: periodTo }, periodTo: { gte: periodFrom } },
  });
  if (overlap) {
    return {
      ok: false,
      error: `This overlaps the period ${iso(overlap.periodFrom)} to ${iso(overlap.periodTo)}, which is already open.`,
    };
  }

  // The previous period's unrelieved losses are this period's opening pool.
  // Carrying it over by hand is the step everyone forgets, so the previous
  // period is recomputed in full — from its own ledger profit, not from its
  // adjustments alone, which would leave the loss wrong by the whole of the
  // profit that year.
  const previous = await db.corporateTaxReturn.findFirst({
    where: { companyId, periodTo: { lte: periodFrom } },
    orderBy: { periodTo: "desc" },
    include: { adjustments: true },
  });
  let lossesBroughtForward = 0;
  if (previous) {
    const company = await db.company.findUnique({ where: { id: companyId } });
    const pl = await profitAndLoss(companyId, previous.periodFrom, previous.periodTo, company?.openingAsOf);
    const prev = compute({
      accountingProfit: pl.accountingProfit,
      revenue: pl.income,
      adjustments: previous.adjustments,
      lossesBroughtForward: previous.lossesBroughtForward,
      sbrElected: previous.sbrElected,
      periodTo: previous.periodTo,
    });
    lossesBroughtForward = Math.max(0, prev.lossesCarriedForward);
  }

  const created = await db.corporateTaxReturn.create({
    data: { companyId, periodFrom, periodTo, lossesBroughtForward, status: "Draft" },
  });
  await audit({
    action: "Created",
    entity: "CorporateTaxReturn",
    entityId: created.id,
    summary: `Opened the corporate tax period ${iso(periodFrom)} to ${iso(periodTo)}, due ${iso(dueDate(periodTo))}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true, id: created.id };
}

export async function updateReturn(formData: FormData): Promise<Result> {
  if (!(await allow("finance.corptax", "edit"))) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") || "");
  const row = await db.corporateTaxReturn.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.status === "Filed") {
    return { ok: false, error: "This return has been filed. Reopen it before changing anything." };
  }

  const losses = toFils(Number(formData.get("lossesBroughtForward")) || 0);
  if (losses < 0) return { ok: false, error: "Losses brought forward cannot be negative" };

  await db.corporateTaxReturn.update({
    where: { id },
    data: {
      lossesBroughtForward: losses,
      sbrElected: String(formData.get("sbrElected") || "") === "on",
      notes: String(formData.get("notes") || "").trim() || null,
    },
  });
  await audit({
    action: "Updated",
    entity: "CorporateTaxReturn",
    entityId: id,
    summary: `Updated the corporate tax return for ${iso(row.periodFrom)} to ${iso(row.periodTo)}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

export async function addAdjustment(formData: FormData): Promise<Result> {
  if (!(await allow("finance.corptax", "edit"))) return { ok: false, error: "Not authorised" };
  const returnId = String(formData.get("returnId") || "");
  const row = await db.corporateTaxReturn.findUnique({ where: { id: returnId } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.status === "Filed") {
    return { ok: false, error: "This return has been filed. Reopen it before adding anything." };
  }

  const category = String(formData.get("category") || "").trim();
  if (!CATEGORY_KEYS.includes(category)) return { ok: false, error: "Choose what kind of adjustment this is" };

  const raw = String(formData.get("kind") || "").trim();
  const kind = (ADJUSTMENT_KINDS as readonly string[]).includes(raw) ? raw : categoryKind(category);

  const amount = toFils(Number(formData.get("amount")) || 0);
  if (amount <= 0) {
    // A negative add-back is a deduction wearing a disguise, and it makes the
    // return unreadable. Ask for the kind instead of the sign.
    return { ok: false, error: "Enter a positive amount, and choose whether it is added back or deducted." };
  }

  const label = String(formData.get("label") || "").trim() || category;

  const created = await db.corporateTaxAdjustment.create({
    data: {
      returnId,
      kind,
      category,
      label,
      amount,
      notes: String(formData.get("notes") || "").trim() || null,
    },
  });
  await audit({
    action: "Created",
    entity: "CorporateTaxAdjustment",
    entityId: created.id,
    summary: `${kind}: ${label} — ${money(amount)}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

export async function deleteAdjustment(id: string): Promise<Result> {
  if (!(await allow("finance.corptax", "edit"))) return { ok: false, error: "Not authorised" };
  const row = await db.corporateTaxAdjustment.findUnique({ where: { id }, include: { return: true } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.return.companyId))) return { ok: false, error: "No access" };
  if (row.return.status === "Filed") {
    return { ok: false, error: "This return has been filed. Reopen it before removing anything." };
  }
  await db.corporateTaxAdjustment.delete({ where: { id } });
  await audit({
    action: "Deleted",
    entity: "CorporateTaxAdjustment",
    entityId: id,
    summary: `Removed ${row.label} of ${money(row.amount)} from the corporate tax return`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

/**
 * Record that the return went to the FTA.
 *
 * The system did not submit it — a person did, through EmaraTax. What this
 * captures is the date and the acknowledgement number, so the working paper can
 * be tied to the filing it produced, and so the computation stops moving
 * underneath a figure that has already been declared.
 */
export async function markFiled(formData: FormData): Promise<Result> {
  if (!(await allow("finance.corptax", "edit"))) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") || "");
  const row = await db.corporateTaxReturn.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.status === "Filed") return { ok: false, error: "This return is already marked as filed." };

  const filedOn = asDate(formData.get("filedOn")) ?? new Date();
  const filedRef = String(formData.get("filedRef") || "").trim();
  if (!filedRef) {
    return { ok: false, error: "Enter the EmaraTax reference, so this working paper can be matched to the filing." };
  }

  await db.corporateTaxReturn.update({
    where: { id },
    data: { status: "Filed", filedOn, filedRef },
  });
  await audit({
    action: "Approved",
    entity: "CorporateTaxReturn",
    entityId: id,
    summary: `Marked the ${iso(row.periodFrom)} to ${iso(row.periodTo)} corporate tax return as filed, reference ${filedRef}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

/**
 * Reopen a filed return.
 *
 * A return is amended more often than anyone expects — an audit adjustment, a
 * cost agreed late. Reopening leaves the original filing reference in place so
 * the trail shows what was declared first, and the audit log records who
 * decided to change it.
 */
export async function reopenReturn(id: string): Promise<Result> {
  if (!(await allow("finance.corptax", "approve"))) {
    return { ok: false, error: "Reopening a filed return needs approval rights" };
  }
  const row = await db.corporateTaxReturn.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.status !== "Filed") return { ok: false, error: "This return is not filed." };

  await db.corporateTaxReturn.update({ where: { id }, data: { status: "Draft" } });
  await audit({
    action: "Updated",
    entity: "CorporateTaxReturn",
    entityId: id,
    summary: `Reopened the ${iso(row.periodFrom)} to ${iso(row.periodTo)} corporate tax return, filed as ${row.filedRef ?? "—"}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

export async function deleteReturn(id: string): Promise<Result> {
  if (!(await allow("finance.corptax", "delete"))) return { ok: false, error: "Not authorised" };
  const row = await db.corporateTaxReturn.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.status === "Filed") {
    return { ok: false, error: "A filed return is the record of what was declared. Reopen it first if it really must go." };
  }
  await db.corporateTaxReturn.delete({ where: { id } });
  await audit({
    action: "Deleted",
    entity: "CorporateTaxReturn",
    entityId: id,
    summary: `Deleted the draft corporate tax return for ${iso(row.periodFrom)} to ${iso(row.periodTo)}`,
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}

/**
 * The company's corporate tax registration number.
 *
 * It is not the VAT TRN. A company can hold one and not the other, and the
 * return quotes this one — so it is captured here, beside the return that needs
 * it, rather than being hunted for in a settings screen.
 */
export async function setCorporateTaxTRN(formData: FormData): Promise<Result> {
  if (!(await allow("finance.corptax", "edit"))) return { ok: false, error: "Not authorised" };
  const companyId = String(formData.get("companyId") || "");
  if (!(await scoped(companyId))) return { ok: false, error: "No access to this company" };

  const raw = String(formData.get("corporateTaxTRN") || "").trim();
  if (!raw) {
    await db.company.update({ where: { id: companyId }, data: { corporateTaxTRN: null } });
    revalidatePath("/finance/corporate-tax");
    return { ok: true };
  }
  const checked = cleanTrn(raw);
  if (checked.error) return { ok: false, error: checked.error };

  await db.company.update({ where: { id: companyId }, data: { corporateTaxTRN: checked.value } });
  await audit({
    action: "Updated",
    entity: "Company",
    entityId: companyId,
    summary: "Set the corporate tax registration number",
  });
  revalidatePath("/finance/corporate-tax");
  return { ok: true };
}
