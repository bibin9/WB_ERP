"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { postVoucher } from "@/lib/posting";
import { toFils, money } from "@/lib/money";
import { DIRECTIONS, STAGES } from "@/lib/retention";
import { accountsForPosting } from "@/lib/accounts";

/**
 * The retention register.
 *
 * Recording an entry writes nothing to the ledger: the certificate that
 * withheld the money already posted it. This is the record of what that money
 * is and when it can be asked for — the part that was living in a spreadsheet.
 *
 * Releasing is the posting. It moves the amount out of retention and into the
 * ordinary receivable or payable, so it starts appearing in ageing and gets
 * chased or paid like any other balance.
 */

type Result = { ok: boolean; error?: string };

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  if (!session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

function readForm(formData: FormData) {
  const dueStr = String(formData.get("dueDate") || "").trim();
  const direction = String(formData.get("direction") || "Receivable");
  const stage = String(formData.get("stage") || "Defects liability");
  const pct = Number(formData.get("percent"));
  return {
    direction: (DIRECTIONS as readonly string[]).includes(direction) ? direction : "Receivable",
    reference: String(formData.get("reference") || "").trim(),
    jobId: String(formData.get("jobId") || "").trim() || null,
    partyId: String(formData.get("partyId") || "").trim() || null,
    amount: toFils(Number(formData.get("amount")) || 0),
    percent: Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueStr) ? new Date(dueStr + "T00:00:00.000Z") : null,
    stage: (STAGES as readonly string[]).includes(stage) ? stage : "Defects liability",
    notes: String(formData.get("notes") || "").trim() || null,
  };
}

export async function recordRetention(formData: FormData): Promise<Result> {
  if (!(await allow("finance.retention", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = String(formData.get("companyId") || "");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const d = readForm(formData);
  if (!d.reference) return { ok: false, error: "Enter the certificate or invoice this was withheld from" };
  if (d.amount <= 0) return { ok: false, error: "Enter the amount held" };
  if (!d.dueDate) return { ok: false, error: "Enter the date it can be released" };

  if (d.jobId && !(await db.job.findFirst({ where: { id: d.jobId, companyId } }))) {
    return { ok: false, error: "That job is not in this company" };
  }
  let partyName: string | null = null;
  if (d.partyId) {
    const party = await db.party.findFirst({ where: { id: d.partyId, companyId } });
    if (!party) return { ok: false, error: "That customer or supplier is not on this company" };
    partyName = party.name;
  }

  // The same certificate withheld twice is almost always the same money being
  // entered again, which would overstate what is owed back.
  const clash = await db.retention.findFirst({
    where: { companyId, direction: d.direction, reference: d.reference, stage: d.stage },
  });
  if (clash) {
    return {
      ok: false,
      error: `Retention for ${d.reference} at ${d.stage.toLowerCase()} is already in the register, for ${money(clash.amount)}.`,
    };
  }

  const { dueDate, ...rest } = d;
  const created = await db.retention.create({
    data: { companyId, ...rest, dueDate, partyName, status: "Held" },
  });
  await audit({
    action: "Created",
    entity: "Retention",
    entityId: created.id,
    summary: `Recorded ${d.direction.toLowerCase()} retention of ${money(d.amount)} on ${d.reference}, releasable ${dueDate.toISOString().slice(0, 10)}`,
  });
  revalidatePath("/finance/retention");
  return { ok: true };
}

export async function updateRetention(formData: FormData): Promise<Result> {
  if (!(await allow("finance.retention", "edit"))) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") || "");
  const row = await db.retention.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.entryId) {
    return { ok: false, error: "This retention has been released and posted. Reverse that voucher in the Day Book to change it." };
  }

  const d = readForm(formData);
  if (!d.reference) return { ok: false, error: "Enter the certificate or invoice" };
  if (d.amount <= 0) return { ok: false, error: "Enter the amount held" };
  if (!d.dueDate) return { ok: false, error: "Enter the date it can be released" };
  if (d.jobId && !(await db.job.findFirst({ where: { id: d.jobId, companyId: row.companyId } }))) {
    return { ok: false, error: "That job is not in this company" };
  }
  const party = d.partyId ? await db.party.findFirst({ where: { id: d.partyId, companyId: row.companyId } }) : null;
  if (d.partyId && !party) return { ok: false, error: "That customer or supplier is not on this company" };

  const { dueDate, ...rest } = d;
  await db.retention.update({ where: { id }, data: { ...rest, dueDate, partyName: party?.name ?? null } });
  await audit({ action: "Updated", entity: "Retention", entityId: id, summary: `Updated retention on ${d.reference}` });
  revalidatePath("/finance/retention");
  return { ok: true };
}

/**
 * Release retention into the ordinary receivable or payable.
 *
 *   Receivable   Dr 1100 Accounts Receivable / Cr 1160 Retention Receivable
 *   Payable      Dr 2200 Retention Payable   / Cr 2000 Accounts Payable
 *
 * Nothing is created or destroyed: the amount simply stops being retention and
 * starts being an ordinary balance, so it appears in ageing and gets chased.
 */
export async function releaseRetention(id: string, onDate?: string): Promise<Result> {
  if (!(await allow("finance.retention", "edit"))) return { ok: false, error: "Not authorised" };
  const row = await db.retention.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  const session = await scoped(row.companyId);
  if (!session) return { ok: false, error: "No access" };
  if (row.status !== "Held") return { ok: false, error: `This retention is already ${row.status.toLowerCase()}.` };

  const receivable = row.direction === "Receivable";
  // Roles, not numbers: a customer with their own chart maps these on
  // Finance → Settings and nothing here has to change.
  const resolved = await accountsForPosting(row.companyId, [
    receivable ? "retentionReceivable" : "retentionPayable",
    receivable ? "accountsReceivable" : "accountsPayable",
  ]);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const retentionAcc = { id: resolved.ids[receivable ? "retentionReceivable" : "retentionPayable"] };
  const ordinaryAcc = { id: resolved.ids[receivable ? "accountsReceivable" : "accountsPayable"] };

  const dateStr = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : new Date().toISOString().slice(0, 10);

  const posted = await postVoucher({
    companyId: row.companyId,
    postedBy: session.user.name,
    voucherType: "Journal",
    date: dateStr,
    partyId: row.partyId,
    memo: `Retention released on ${row.reference}${row.stage ? ` — ${row.stage.toLowerCase()}` : ""}`,
    lines: receivable
      ? [
          { accountId: ordinaryAcc.id, debit: row.amount, credit: 0 },
          { accountId: retentionAcc.id, debit: 0, credit: row.amount },
        ]
      : [
          { accountId: retentionAcc.id, debit: row.amount, credit: 0 },
          { accountId: ordinaryAcc.id, debit: 0, credit: row.amount },
        ],
    sourceType: "retention",
    sourceId: row.id,
    source: "retention",
  });
  if (!posted.ok) return posted;

  await db.retention.update({
    where: { id },
    data: { status: "Released", releasedOn: new Date(dateStr + "T00:00:00.000Z"), entryId: posted.entryId },
  });
  await audit({
    action: "Posted",
    entity: "Retention",
    entityId: id,
    summary: `Released ${money(row.amount)} retention on ${row.reference} as ${posted.reference}`,
  });
  revalidatePath("/finance/retention");
  revalidatePath("/finance/daybook");
  revalidatePath("/finance/outstanding");
  return { ok: true };
}

export async function deleteRetention(id: string): Promise<Result> {
  if (!(await allow("finance.retention", "delete"))) return { ok: false, error: "Not authorised" };
  const row = await db.retention.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };
  if (row.entryId) {
    return { ok: false, error: "This retention has been released and posted. Reverse that voucher in the Day Book instead." };
  }
  await db.retention.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Retention", entityId: id, summary: `Removed retention on ${row.reference}` });
  revalidatePath("/finance/retention");
  return { ok: true };
}
