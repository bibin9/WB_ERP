"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { money } from "@/lib/money";
import {
  recordAdvance as postRecord,
  recoverAdvance as postRecover,
  closeAdvance as postClose,
} from "@/lib/advance-posting";

/**
 * The advances screen.
 *
 * These are wrappers: they check the caller is allowed, read the form, and hand
 * the work to lib/advance-posting, which is where the accounting lives and
 * where it can be tested against a real database. A server action needs a
 * request behind it, so anything written here could only ever be checked by
 * reading it as text.
 */

type Result = { ok: boolean; error?: string };

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  if (!session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;

export async function recordAdvance(formData: FormData): Promise<Result> {
  if (!(await allow("finance.advances", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const res = await postRecord({
    companyId,
    postedBy: session.user.name,
    direction: str(formData, "direction") || "Received",
    reference: str(formData, "reference", 120),
    partyId: str(formData, "partyId"),
    bankAccountId: str(formData, "bankAccountId"),
    date: str(formData, "date"),
    amount: Number(formData.get("amount")) || 0,
    jobId: orNull(formData, "jobId"),
    recoveryPercent: Number(formData.get("recoveryPercent")),
    notes: orNull(formData, "notes", 500),
  });
  if (!res.ok) return res;

  await audit({
    action: "Posted",
    entity: "PartyAdvance",
    entityId: res.advanceId,
    summary: `Advance of ${money(Number(formData.get("amount")) || 0)} recorded on ${str(formData, "reference", 120)}, posted as ${res.reference}`,
  });
  revalidatePath("/finance/advances");
  revalidatePath("/finance/daybook");
  return { ok: true };
}

export async function recoverAdvance(formData: FormData): Promise<Result> {
  if (!(await allow("finance.advances", "edit"))) return { ok: false, error: "Not authorised" };
  const id = str(formData, "id");
  const row = await db.partyAdvance.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  const session = await scoped(row.companyId);
  if (!session) return { ok: false, error: "No access" };

  const amount = Number(formData.get("amount")) || 0;
  const res = await postRecover({
    advanceId: id,
    postedBy: session.user.name,
    amount,
    date: str(formData, "date"),
    invoiceId: orNull(formData, "invoiceId"),
    notes: orNull(formData, "notes", 500),
  });
  if (!res.ok) return res;

  await audit({
    action: "Posted",
    entity: "PartyAdvance",
    entityId: id,
    summary: `Recovered ${money(amount)} of the advance on ${row.reference} as ${res.reference}`,
  });
  revalidatePath("/finance/advances");
  revalidatePath("/finance/daybook");
  revalidatePath("/finance/outstanding");
  return { ok: true };
}

export async function closeAdvance(formData: FormData): Promise<Result> {
  if (!(await allow("finance.advances", "edit"))) return { ok: false, error: "Not authorised" };
  const id = str(formData, "id");
  const row = await db.partyAdvance.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  const session = await scoped(row.companyId);
  if (!session) return { ok: false, error: "No access" };

  const res = await postClose({
    advanceId: id,
    postedBy: session.user.name,
    status: str(formData, "status"),
    date: str(formData, "date"),
    bankAccountId: orNull(formData, "bankAccountId"),
    writeOffAccountId: orNull(formData, "writeOffAccountId"),
  });
  if (!res.ok) return res;

  await audit({
    action: "Posted",
    entity: "PartyAdvance",
    entityId: id,
    summary: `Advance on ${row.reference} ${str(formData, "status").toLowerCase()} as ${res.reference}`,
  });
  revalidatePath("/finance/advances");
  revalidatePath("/finance/daybook");
  return { ok: true };
}

/**
 * Correct a register entry.
 *
 * Only the descriptive fields move. The amount and the date are on a posted
 * voucher, and changing those behind the ledger's back is how a register stops
 * agreeing with the accounts — reverse the voucher in the Day Book instead.
 */
export async function updateAdvance(formData: FormData): Promise<Result> {
  if (!(await allow("finance.advances", "edit"))) return { ok: false, error: "Not authorised" };
  const id = str(formData, "id");
  const row = await db.partyAdvance.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found" };
  if (!(await scoped(row.companyId))) return { ok: false, error: "No access" };

  const jobId = orNull(formData, "jobId");
  if (jobId && !(await db.job.findFirst({ where: { id: jobId, companyId: row.companyId } }))) {
    return { ok: false, error: "That job is not in this company" };
  }
  const pct = Number(formData.get("recoveryPercent"));

  await db.partyAdvance.update({
    where: { id },
    data: {
      jobId,
      recoveryPercent: Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null,
      notes: orNull(formData, "notes", 500),
    },
  });
  await audit({
    action: "Updated",
    entity: "PartyAdvance",
    entityId: id,
    summary: `Updated the register entry for the advance on ${row.reference}`,
  });
  revalidatePath("/finance/advances");
  return { ok: true };
}
