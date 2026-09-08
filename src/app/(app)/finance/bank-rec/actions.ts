"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";

/**
 * Ticking lines off against a bank statement.
 *
 * Nothing here posts. Clearing a line records that the bank has shown it —
 * the money moved when the voucher was posted, and saying so twice would
 * double it. What this changes is only whether a difference between the books
 * and the statement is explained or not.
 */

type Result = { ok: boolean; error?: string };

/** A line is only touchable if its account belongs to a company the user has. */
async function scopedLine(lineId: string) {
  const session = await getSession();
  if (!session) return null;
  const line = await db.journalLine.findUnique({
    where: { id: lineId },
    include: { account: { select: { companyId: true, code: true } }, entry: { select: { reference: true } } },
  });
  if (!line) return null;
  if (!session.companies.some((c) => c.id === line.account.companyId)) return null;
  return { session, line };
}

export async function setLineCleared(
  lineId: string,
  cleared: boolean,
  onDate?: string,
  statementRef?: string
): Promise<Result> {
  if (!(await allow("finance.bankrec", "edit"))) return { ok: false, error: "Not authorised" };
  const scoped = await scopedLine(lineId);
  if (!scoped) return { ok: false, error: "Not found" };

  const dateStr = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : new Date().toISOString().slice(0, 10);

  await db.journalLine.update({
    where: { id: lineId },
    data: cleared
      ? { clearedOn: new Date(dateStr + "T00:00:00.000Z"), statementRef: statementRef?.trim() || null }
      : { clearedOn: null, statementRef: null },
  });
  revalidatePath("/finance/bank-rec");
  return { ok: true };
}

/**
 * Tick everything on or before a date.
 *
 * The ordinary case: last month's statement has arrived, almost everything on
 * it cleared, and ticking forty lines one at a time is how reconciliations stop
 * getting done. Anything that did not clear is then unticked by hand, which is
 * a much shorter list.
 */
export async function clearUpTo(
  companyId: string,
  accountId: string,
  toDate: string,
  statementRef?: string
): Promise<Result & { count?: number }> {
  if (!(await allow("finance.bankrec", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return { ok: false, error: "Choose a statement date" };

  const account = await db.chartOfAccount.findFirst({ where: { id: accountId, companyId } });
  if (!account) return { ok: false, error: "That account is not in this company" };

  const to = new Date(toDate + "T23:59:59.999Z");
  const result = await db.journalLine.updateMany({
    where: { accountId, clearedOn: null, entry: { companyId, date: { lte: to } } },
    data: { clearedOn: new Date(toDate + "T00:00:00.000Z"), statementRef: statementRef?.trim() || null },
  });

  await audit({
    action: "Updated",
    entity: "ChartOfAccount",
    entityId: accountId,
    summary: `Reconciled ${result.count} line(s) on ${account.code} up to ${toDate}${statementRef ? ` (${statementRef})` : ""}`,
  });
  revalidatePath("/finance/bank-rec");
  return { ok: true, count: result.count };
}

/** Undo a whole statement's worth of ticks, when one was done against the wrong month. */
export async function unclearStatement(companyId: string, accountId: string, statementRef: string): Promise<Result & { count?: number }> {
  if (!(await allow("finance.bankrec", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!session.companies.some((c) => c.id === companyId)) return { ok: false, error: "No access to this company" };
  if (!statementRef.trim()) return { ok: false, error: "Name the statement to undo" };

  const account = await db.chartOfAccount.findFirst({ where: { id: accountId, companyId } });
  if (!account) return { ok: false, error: "That account is not in this company" };

  const result = await db.journalLine.updateMany({
    where: { accountId, statementRef: statementRef.trim() },
    data: { clearedOn: null, statementRef: null },
  });
  await audit({
    action: "Updated",
    entity: "ChartOfAccount",
    entityId: accountId,
    summary: `Unreconciled ${result.count} line(s) on ${account.code} from statement ${statementRef}`,
  });
  revalidatePath("/finance/bank-rec");
  return { ok: true, count: result.count };
}
