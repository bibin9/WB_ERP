"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { postVoucher } from "@/lib/posting";
import { toFils, money } from "@/lib/money";
import { DIRECTIONS, CHEQUE_STATUSES, canMove, settles } from "@/lib/cheques";
import { accountsForPosting } from "@/lib/accounts";

/**
 * The cheque register.
 *
 * Recording a cheque writes nothing to the ledger — it is a memo of a promise.
 * Clearing one posts a receipt or a payment, because that is the day the money
 * actually moved. A bounce therefore has nothing to unwind, which is the point:
 * the common unhappy path costs the accountant no work.
 */

type Result = { ok: boolean; error?: string };

// The accounts a cheque touches are asked for by role, so a company with its
// own chart maps them once on Finance → Settings.

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  if (!session.companies.some((c) => c.id === companyId)) return null;
  return session;
}

function readForm(formData: FormData) {
  const dateStr = String(formData.get("chequeDate") || "").trim();
  const direction = String(formData.get("direction") || "Received");
  return {
    direction: (DIRECTIONS as readonly string[]).includes(direction) ? direction : "Received",
    chequeNo: String(formData.get("chequeNo") || "").trim(),
    bankName: String(formData.get("bankName") || "").trim() || null,
    chequeDate: /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + "T00:00:00.000Z") : null,
    amount: toFils(Number(formData.get("amount")) || 0),
    partyId: String(formData.get("partyId") || "").trim() || null,
    heldBy: String(formData.get("heldBy") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
  };
}

export async function recordCheque(formData: FormData): Promise<Result> {
  if (!(await allow("finance.cheques", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = String(formData.get("companyId") || "");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const d = readForm(formData);
  if (!d.chequeNo) return { ok: false, error: "Enter the cheque number" };
  if (!d.chequeDate) return { ok: false, error: "Enter the date written on the cheque" };
  if (d.amount <= 0) return { ok: false, error: "Enter the amount" };

  let partyName: string | null = null;
  if (d.partyId) {
    const party = await db.party.findFirst({ where: { id: d.partyId, companyId } });
    if (!party) return { ok: false, error: "That customer or supplier is not on this company" };
    partyName = party.name;
  }

  // The same number from the same bank is almost always the same cheque being
  // entered twice, which would double the forecast.
  const clash = await db.cheque.findFirst({
    where: { companyId, direction: d.direction, bankName: d.bankName, chequeNo: d.chequeNo },
  });
  if (clash) {
    return {
      ok: false,
      error: `Cheque ${d.chequeNo}${d.bankName ? ` on ${d.bankName}` : ""} is already in the register, dated ${clash.chequeDate.toISOString().slice(0, 10)}.`,
    };
  }

  const { chequeDate, ...rest } = d;
  const created = await db.cheque.create({
    data: { companyId, ...rest, chequeDate, partyName, status: "In hand" },
  });
  await audit({
    action: "Created",
    entity: "Cheque",
    entityId: created.id,
    summary: `Recorded ${d.direction.toLowerCase()} cheque ${d.chequeNo} for ${money(d.amount)} dated ${d.chequeDate.toISOString().slice(0, 10)}`,
  });
  revalidatePath("/finance/cheques");
  return { ok: true };
}

export async function updateCheque(formData: FormData): Promise<Result> {
  if (!(await allow("finance.cheques", "edit"))) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") || "");
  const cheque = await db.cheque.findUnique({ where: { id } });
  if (!cheque) return { ok: false, error: "Not found" };
  const session = await scoped(cheque.companyId);
  if (!session) return { ok: false, error: "No access" };

  // Once it has cleared it has a voucher behind it; changing the amount then
  // would make the register and the ledger disagree.
  if (cheque.entryId) {
    return { ok: false, error: "This cheque has been cleared and posted. Reverse the voucher in the Day Book to change it." };
  }

  const d = readForm(formData);
  if (!d.chequeNo) return { ok: false, error: "Enter the cheque number" };
  if (!d.chequeDate) return { ok: false, error: "Enter the date written on the cheque" };
  if (d.amount <= 0) return { ok: false, error: "Enter the amount" };
  if (d.partyId && !(await db.party.findFirst({ where: { id: d.partyId, companyId: cheque.companyId } }))) {
    return { ok: false, error: "That customer or supplier is not on this company" };
  }
  const party = d.partyId ? await db.party.findUnique({ where: { id: d.partyId } }) : null;

  const { chequeDate, ...rest } = d;
  await db.cheque.update({ where: { id }, data: { ...rest, chequeDate, partyName: party?.name ?? null } });
  await audit({ action: "Updated", entity: "Cheque", entityId: id, summary: `Updated cheque ${d.chequeNo}` });
  revalidatePath("/finance/cheques");
  return { ok: true };
}

/**
 * Move a cheque along: deposited, cleared, bounced, returned.
 *
 * Clearing is the only one that writes to the ledger, and it goes through
 * postVoucher like everything else, so the period lock and company ownership
 * apply without being restated.
 */
export async function setChequeStatus(id: string, next: string, onDate?: string): Promise<Result> {
  if (!(await allow("finance.cheques", "edit"))) return { ok: false, error: "Not authorised" };
  if (!(CHEQUE_STATUSES as readonly string[]).includes(next)) return { ok: false, error: "Unknown status" };

  const cheque = await db.cheque.findUnique({ where: { id } });
  if (!cheque) return { ok: false, error: "Not found" };
  const session = await scoped(cheque.companyId);
  if (!session) return { ok: false, error: "No access" };

  if (!canMove(cheque.status, next)) {
    return { ok: false, error: `A cheque that is ${cheque.status.toLowerCase()} cannot go straight to ${next.toLowerCase()}.` };
  }
  if (cheque.entryId && settles(cheque.status)) {
    return { ok: false, error: "This cheque has already been cleared and posted." };
  }

  const dateStr = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : new Date().toISOString().slice(0, 10);

  if (!settles(next)) {
    await db.cheque.update({
      where: { id },
      data: {
        status: next,
        depositedOn: next === "Deposited" ? new Date(dateStr + "T00:00:00.000Z") : cheque.depositedOn,
        settledOn: next === "Bounced" || next === "Returned" ? new Date(dateStr + "T00:00:00.000Z") : null,
      },
    });
    await audit({ action: "Updated", entity: "Cheque", entityId: id, summary: `Cheque ${cheque.chequeNo} marked ${next}` });
    revalidatePath("/finance/cheques");
    return { ok: true };
  }

  // Cleared: the money has actually moved, so post it.
  const controlRole = cheque.direction === "Received" ? "accountsReceivable" : "accountsPayable";
  const resolved = await accountsForPosting(cheque.companyId, ["bank", controlRole]);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const bank = { id: resolved.ids.bank };
  const control = { id: resolved.ids[controlRole] };

  const received = cheque.direction === "Received";
  const posted = await postVoucher({
    companyId: cheque.companyId,
    postedBy: session.user.name,
    voucherType: received ? "Receipt" : "Payment",
    date: dateStr,
    partyId: cheque.partyId,
    memo: `Cheque ${cheque.chequeNo}${cheque.bankName ? ` — ${cheque.bankName}` : ""} cleared`,
    lines: received
      ? [
          { accountId: bank.id, debit: cheque.amount, credit: 0 },
          { accountId: control.id, debit: 0, credit: cheque.amount },
        ]
      : [
          { accountId: control.id, debit: cheque.amount, credit: 0 },
          { accountId: bank.id, debit: 0, credit: cheque.amount },
        ],
    sourceType: "cheque",
    sourceId: cheque.id,
    source: "cheque",
  });
  if (!posted.ok) return posted;

  await db.cheque.update({
    where: { id },
    data: { status: "Cleared", settledOn: new Date(dateStr + "T00:00:00.000Z"), entryId: posted.entryId },
  });
  await audit({
    action: "Posted",
    entity: "Cheque",
    entityId: id,
    summary: `Cheque ${cheque.chequeNo} cleared for ${money(cheque.amount)} as ${posted.reference}`,
  });
  revalidatePath("/finance/cheques");
  revalidatePath("/finance/daybook");
  revalidatePath("/finance/outstanding");
  return { ok: true };
}

export async function deleteCheque(id: string): Promise<Result> {
  if (!(await allow("finance.cheques", "delete"))) return { ok: false, error: "Not authorised" };
  const cheque = await db.cheque.findUnique({ where: { id } });
  if (!cheque) return { ok: false, error: "Not found" };
  if (!(await scoped(cheque.companyId))) return { ok: false, error: "No access" };
  if (cheque.entryId) {
    return { ok: false, error: "This cheque has been cleared and posted. Reverse the voucher in the Day Book instead." };
  }
  await db.cheque.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "Cheque", entityId: id, summary: `Removed cheque ${cheque.chequeNo} from the register` });
  revalidatePath("/finance/cheques");
  return { ok: true };
}
