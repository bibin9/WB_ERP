"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postVoucher, VOUCHER_PREFIX, type PostingLine } from "@/lib/posting";
import { financialYear } from "@/lib/period";
import { allow } from "@/lib/guard";
import { toFils } from "@/lib/money";


export async function createJournalEntry(formData: FormData) {
  if (!(await allow("finance.overview", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access" };

  let lines: PostingLine[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    return { ok: false, error: "Invalid lines" };
  }

  const voucherType = String(formData.get("voucherType") || "Journal");

  // Every rule that protects the books lives in postVoucher, so a voucher
  // raised by another module obeys exactly the same ones as a typed-in voucher.
  const result = await postVoucher({
    companyId,
    postedBy: session.user.name,
    voucherType,
    date: String(formData.get("date") || "").trim() || null,
    partyId: String(formData.get("partyId") || "").trim() || null,
    vatAmount: Number(formData.get("vatAmount")) || 0,
    memo: String(formData.get("memo") || "").trim() || null,
    lines,
  });
  if (!result.ok) return result;

  await audit({
    action: "Posted",
    entity: "JournalEntry",
    entityId: result.entryId,
    summary: `Posted ${voucherType} ${result.reference}`,
  });
  revalidatePath("/finance");
  revalidatePath("/finance/daybook");
  return { ok: true };
}


const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

/** Which control account this is, if any — what the outstanding report measures. */
function controlFrom(formData: FormData): string | null {
  const v = String(formData.get("controlType") || "").trim();
  return v === "Receivable" || v === "Payable" ? v : null;
}

/**
 * Opening balance from the form: an amount plus a Dr/Cr side, stored signed
 * (debit positive) so it adds straight into the ledger arithmetic.
 */
function openingFrom(formData: FormData): number {
  const amount = toFils(Math.abs(Number(formData.get("openingAmount")) || 0));
  const side = String(formData.get("openingSide") || "Dr");
  return side === "Cr" ? -amount : amount;
}

export async function createAccount(formData: FormData) {
  if (!(await allow("finance.ledgers", "create"))) return;
  const session = await getSession();
  if (!session) return;
  const companyId = String(formData.get("companyId") || "");
  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "");
  if (!session.companies.some((c) => c.id === companyId) || !code || !name || !ACCOUNT_TYPES.includes(type)) return;
  const exists = await db.chartOfAccount.findUnique({ where: { companyId_code: { companyId, code } } });
  if (exists) return;
  const created = await db.chartOfAccount.create({ data: { companyId, code, name, type, openingBalance: openingFrom(formData), controlType: controlFrom(formData) } });
  await audit({ action: "Created", entity: "ChartOfAccount", entityId: created.id, summary: `Added account ${code} — ${name}` });
  revalidatePath("/finance");
}

export async function updateAccount(formData: FormData) {
  if (!(await allow("finance.ledgers", "edit"))) return;
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") || "");
  const acc = await db.chartOfAccount.findUnique({ where: { id } });
  if (!acc || !session.companies.some((c) => c.id === acc.companyId)) return;
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "");
  if (!name || !ACCOUNT_TYPES.includes(type)) return;
  await db.chartOfAccount.update({ where: { id }, data: { name, type, openingBalance: openingFrom(formData), controlType: controlFrom(formData) } });
  await audit({ action: "Updated", entity: "ChartOfAccount", entityId: id, summary: `Updated account ${acc.code} — ${name}` });
  revalidatePath("/finance");
}

export async function deleteAccount(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allow("finance.ledgers", "delete"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const acc = await db.chartOfAccount.findUnique({ where: { id } });
  if (!acc || !session.companies.some((c) => c.id === acc.companyId)) return { ok: false, error: "Not found" };
  const used = await db.journalLine.count({ where: { accountId: id } });
  if (used > 0) return { ok: false, error: "Account has postings" };
  await db.chartOfAccount.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "ChartOfAccount", entityId: id, summary: `Deleted account ${acc.code} — ${acc.name}` });
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * Reverse a posted voucher.
 *
 * Posted entries are never edited or deleted — that is what makes the audit
 * trail worth having. A mistake is corrected the way an accountant corrects
 * one: by posting the opposite entry, dated when you choose, linked to the
 * original so both sides stay visible.
 */
export async function reverseJournalEntry(
  entryId: string,
  onDate: string
): Promise<{ ok: boolean; error?: string; reference?: string }> {
  if (!(await allow("finance.overview", "create"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const original = await db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: true, reversedBy: true, company: true },
  });
  if (!original || !session.companies.some((c) => c.id === original.companyId)) {
    return { ok: false, error: "Not found" };
  }
  // One reversal per voucher. Enforced here rather than by a unique constraint
  // — see the note on the schema field.
  if (original.reversedBy.length > 0) {
    return { ok: false, error: `Already reversed by ${original.reversedBy[0].reference}` };
  }
  if (original.reversalOfId) return { ok: false, error: "This voucher is itself a reversal" };

  if (onDate && !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return { ok: false, error: "Enter a valid date" };
  const date = onDate ? new Date(onDate + "T00:00:00.000Z") : new Date();
  if (isNaN(date.getTime())) return { ok: false, error: "Enter a valid date" };

  // The reversal is a posting like any other, so the same period lock applies.
  if (original.company.booksLockedTo && date <= original.company.booksLockedTo) {
    const upto = original.company.booksLockedTo.toISOString().slice(0, 10);
    return { ok: false, error: `The books are closed up to ${upto}. Reverse it on a later date.` };
  }
  if (date < original.date) return { ok: false, error: "A reversal cannot be dated before the original voucher." };

  const fy = financialYear(original.company.fyStartMonth, date);
  const yearTag = `${String(fy.from.getUTCFullYear()).slice(2)}-${String(fy.to.getUTCFullYear()).slice(2)}`;
  const n = await db.journalEntry.count({
    where: { companyId: original.companyId, voucherType: original.voucherType, date: { gte: fy.from, lte: fy.to } },
  });
  const reference = `${original.company.code}/${VOUCHER_PREFIX[original.voucherType] ?? "JV"}/${yearTag}/${String(n + 1).padStart(4, "0")}`;

  const created = await db.journalEntry.create({
    data: {
      companyId: original.companyId,
      reference,
      date,
      voucherType: original.voucherType,
      // The party id, not only the name: Outstanding & Ageing selects on
      // partyId, so without it a reversed sales invoice would leave the
      // customer showing the full amount as still owing.
      partyId: original.partyId,
      partyName: original.partyName,
      vatAmount: -original.vatAmount,
      memo: `Reversal of ${original.reference}${original.memo ? " — " + original.memo : ""}`,
      postedBy: session.user.name,
      reversalOfId: original.id,
      // Debit and credit swap: that is the whole of a reversal.
      // Carry the job, the cost centre and the VAT treatment through, or the
      // correction would vanish from job costing, from overhead and from the
      // VAT return while the original stayed in all three.
      lines: {
        create: original.lines.map((l) => ({
          accountId: l.accountId, debit: l.credit, credit: l.debit,
          vatTreatment: l.vatTreatment, jobId: l.jobId, costCentreId: l.costCentreId,
        })),
      },
    },
  });

  await audit({
    action: "Posted",
    entity: "JournalEntry",
    entityId: created.id,
    summary: `Reversed ${original.reference} with ${reference}`,
  });
  revalidatePath("/finance");
  revalidatePath("/finance/daybook");
  return { ok: true, reference };
}
