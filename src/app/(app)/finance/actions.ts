"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

type LineInput = { accountId: string; debit: number; credit: number };

export async function createJournalEntry(formData: FormData) {
  if (!(await allow("finance.overview", "create"))) return;
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };

  const companyId = String(formData.get("companyId") || "");
  const memo = String(formData.get("memo") || "").trim();
  const voucherType = String(formData.get("voucherType") || "Journal");
  const partyName = String(formData.get("partyName") || "").trim();
  const vatAmount = Number(formData.get("vatAmount")) || 0;
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access" };

  let lines: LineInput[] = [];
  try {
    lines = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    return { ok: false, error: "Invalid lines" };
  }
  lines = lines
    .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
    .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

  if (lines.length < 2) return { ok: false, error: "At least two lines are required" };

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) || totalDebit === 0) {
    return { ok: false, error: "Entry is not balanced (debits must equal credits)" };
  }

  const PREFIX: Record<string, string> = { Journal: "JV", Payment: "PAY", Receipt: "RCP", Contra: "CTR", Sales: "SAL", Purchase: "PUR" };
  const company = await db.company.findUnique({ where: { id: companyId } });
  const n = await db.journalEntry.count({ where: { companyId, voucherType } });
  const reference = `${PREFIX[voucherType] ?? "JV"}/${company?.code ?? "GEN"}/${String(n + 1).padStart(4, "0")}`;

  const created = await db.journalEntry.create({
    data: {
      companyId,
      reference,
      voucherType,
      partyName: partyName || null,
      vatAmount,
      memo: memo || null,
      postedBy: session.user.name,
      lines: { create: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) },
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
  const created = await db.chartOfAccount.create({ data: { companyId, code, name, type, openingBalance: openingFrom(formData) } });
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
  await db.chartOfAccount.update({ where: { id }, data: { name, type, openingBalance: openingFrom(formData) } });
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
