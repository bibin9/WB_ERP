"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { financialYear } from "@/lib/period";
import { VAT_TREATMENTS } from "@/lib/vat";
import { allow } from "@/lib/guard";

type LineInput = { accountId: string; debit: number; credit: number; vatTreatment?: string | null; jobId?: string | null };

/** Reference prefixes, matching the voucher types offered on the form. */
const VOUCHER_PREFIX: Record<string, string> = {
  Journal: "JV", Payment: "PV", Receipt: "RV", Contra: "CV", Sales: "SI", Purchase: "PI",
  // A credit note goes to a customer (sales return, rate variation, retention
  // release); a debit note goes to a supplier. Both are everyday documents on a
  // contract and reduce the VAT already declared.
  "Credit Note": "CN", "Debit Note": "DN",
};

export async function createJournalEntry(formData: FormData) {
  if (!(await allow("finance.overview", "create"))) return;
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  const memo = String(formData.get("memo") || "").trim();
  const voucherType = String(formData.get("voucherType") || "Journal");
  const partyId = String(formData.get("partyId") || "").trim() || null;
  const vatAmount = Number(formData.get("vatAmount")) || 0;
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access" };

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return { ok: false, error: "Company not found" };

  // The voucher date is the accountant's, not the clock's.
  const dateRaw = String(formData.get("date") || "").trim();
  if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { ok: false, error: "Enter a valid date" };
  const date = dateRaw ? new Date(dateRaw + "T00:00:00.000Z") : new Date();
  if (isNaN(date.getTime())) return { ok: false, error: "Enter a valid date" };

  // A closed period must stay closed: once a VAT return is filed, the figures
  // behind it cannot be allowed to move.
  if (company.booksLockedTo && date <= company.booksLockedTo) {
    const upto = company.booksLockedTo.toISOString().slice(0, 10);
    return { ok: false, error: `The books are closed up to ${upto}. Post this on a later date, or ask an administrator to change the lock.` };
  }

  // The party is a master record now, so outstanding can actually be totalled.
  // Its name is snapshotted on the voucher for the printed document.
  let partyName: string | null = null;
  if (partyId) {
    const party = await db.party.findFirst({ where: { id: partyId, companyId } });
    if (!party) return { ok: false, error: "That customer or supplier is not on this company" };
    partyName = party.name;
  }

  // A date far in the future is nearly always a typo in the year.
  const horizon = new Date(Date.now() + 366 * 24 * 3600 * 1000);
  if (date > horizon) return { ok: false, error: "That date is more than a year ahead — check the year." };

  let lines: LineInput[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    return { ok: false, error: "Invalid lines" };
  }
  lines = lines
    .map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      // Only a treatment the return knows about is stored.
      vatTreatment: VAT_TREATMENTS.includes(l.vatTreatment as never) ? l.vatTreatment : null,
      jobId: l.jobId || null,
    }))
    .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

  if (lines.length < 2) return { ok: false, error: "At least two lines are required" };

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) || totalDebit === 0) {
    return { ok: false, error: "Entry is not balanced (debits must equal credits)" };
  }

  // Numbering restarts each financial year, the way Tally does, and carries the
  // year in the reference so two years can never collide.
  const fy = financialYear(company.fyStartMonth, date);
  const yearTag = `${String(fy.from.getUTCFullYear()).slice(2)}-${String(fy.to.getUTCFullYear()).slice(2)}`;
  const n = await db.journalEntry.count({
    where: { companyId, voucherType, date: { gte: fy.from, lte: fy.to } },
  });
  const reference = `${company.code}/${VOUCHER_PREFIX[voucherType] ?? "JV"}/${yearTag}/${String(n + 1).padStart(4, "0")}`;

  const created = await db.journalEntry.create({
    data: {
      companyId,
      reference,
      date,
      voucherType,
      partyId,
      partyName,
      vatAmount,
      memo: memo || null,
      postedBy: session.user.name,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId, debit: l.debit, credit: l.credit, vatTreatment: l.vatTreatment, jobId: l.jobId,
        })),
      },
    },
  });
  await audit({ action: "Posted", entity: "JournalEntry", entityId: created.id, summary: `Posted ${voucherType} ${reference} (${totalDebit.toLocaleString()})` });

  revalidatePath("/finance");
  return { ok: true, error: "" };
}

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

/**
 * Opening balance from the form: an amount plus a Dr/Cr side, stored signed
 * (debit positive) so it adds straight into the ledger arithmetic.
 */
function controlFrom(formData: FormData): string | null {
  const v = String(formData.get("controlType") || "").trim();
  return v === "Receivable" || v === "Payable" ? v : null;
}

function openingFrom(formData: FormData): number {
  const amount = Math.abs(Number(formData.get("openingAmount")) || 0);
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
      partyName: original.partyName,
      vatAmount: -original.vatAmount,
      memo: `Reversal of ${original.reference}${original.memo ? " — " + original.memo : ""}`,
      postedBy: session.user.name,
      reversalOfId: original.id,
      // Debit and credit swap: that is the whole of a reversal.
      // Carry the job and VAT treatment through, or the correction would
      // vanish from job costing and the VAT return.
      lines: {
        create: original.lines.map((l) => ({
          accountId: l.accountId, debit: l.credit, credit: l.debit,
          vatTreatment: l.vatTreatment, jobId: l.jobId,
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
