import "server-only";
import { db } from "./db";
import { ageParty, type PartyDoc } from "./ageing";
import { financePolicyFor } from "./accounts";
import {
  DEFAULT_PAY_DAY, DEFAULT_WEEKS, startOfDay, weekBuckets, payrollDates,
  type CashEvent,
} from "./cashflow";

/**
 * Gathering what the cash flow forecast is made of.
 *
 * The arithmetic is in cashflow.ts; this is the part that reads the books. Kept
 * apart so the sums can be tested without a database, and so the one genuinely
 * delicate decision here — not counting the same money twice — sits somewhere
 * it can be read and argued with.
 */

export type CashSource = {
  opening: number;
  /** Which accounts the opening balance came from, so the figure is auditable. */
  cashAccounts: { code: string; name: string; balance: number }[];
  events: CashEvent[];
  /** Anything the forecast could not do, said plainly rather than assumed away. */
  warnings: string[];
  payroll: { amount: number; dayOfMonth: number; fromPeriod: string | null };
};

const round = (n: number) => Math.round(n * 100) / 100;

export async function cashSourceFor(
  companyId: string,
  from: Date = new Date(),
  weeks: number = DEFAULT_WEEKS,
): Promise<CashSource> {
  const start = startOfDay(from);
  const spec = weekBuckets(start, weeks);
  const horizonEnd = spec[spec.length - 1].to;
  const warnings: string[] = [];
  const events: CashEvent[] = [];

  const policy = await financePolicyFor(companyId);

  /* ---------------------------------------------------- what is in the bank */
  // Accounts the company has marked as Cash on the chart of accounts. Marking
  // them is a deliberate act, the same as marking Receivable and Payable: a
  // forecast that guessed which account was the bank would be a number nobody
  // could check.
  const cashAccounts = await db.chartOfAccount.findMany({
    where: { companyId, controlType: "Cash" },
    select: { id: true, code: true, name: true, openingBalance: true },
    orderBy: { code: "asc" },
  });

  let opening = 0;
  const cashRows: CashSource["cashAccounts"] = [];
  if (cashAccounts.length === 0) {
    warnings.push(
      "No account is marked as Cash, so the forecast starts from zero. Open Finance → Overview, edit your bank account and set its Control account to 'Cash'.",
    );
  } else {
    const sums = await db.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: cashAccounts.map((a) => a.id) } },
      _sum: { debit: true, credit: true },
    });
    const byAccount = new Map(sums.map((s) => [s.accountId, (s._sum.debit ?? 0) - (s._sum.credit ?? 0)]));
    for (const a of cashAccounts) {
      const balance = round(a.openingBalance + (byAccount.get(a.id) ?? 0));
      cashRows.push({ code: a.code, name: a.name, balance });
      opening = round(opening + balance);
    }
  }

  /* ------------------------------------------------------- dated cheques -- */
  // Anything not yet settled. A cheque that has bounced or been returned is not
  // money on its way; a cleared one has already moved and is in the balance.
  const cheques = await db.cheque.findMany({
    where: { companyId, status: { in: ["In hand", "Deposited"] } },
    select: { chequeNo: true, direction: true, chequeDate: true, amount: true, partyName: true, partyId: true },
    orderBy: { chequeDate: "asc" },
  });

  const chequeInByParty = new Map<string, number>();
  for (const c of cheques) {
    const inbound = c.direction === "Received";
    events.push({
      date: c.chequeDate,
      amount: inbound ? c.amount : -c.amount,
      kind: inbound ? "cheque-in" : "cheque-out",
      label: `Cheque ${c.chequeNo}`,
      party: c.partyName ?? undefined,
      // A cheque we wrote will be presented. One we hold can bounce, which is
      // why it is not treated as certain.
      certainty: inbound ? "likely" : "certain",
      overdue: c.chequeDate.getTime() < start.getTime(),
    });
    if (inbound && c.partyId) {
      chequeInByParty.set(c.partyId, round((chequeInByParty.get(c.partyId) ?? 0) + c.amount));
    }
  }

  /* ------------------------------------------- invoices still to be settled */
  const control = await db.chartOfAccount.findMany({
    where: { companyId, controlType: { in: ["Receivable", "Payable"] } },
    select: { id: true, controlType: true },
  });
  const receivableIds = new Set(control.filter((c) => c.controlType === "Receivable").map((c) => c.id));
  const payableIds = new Set(control.filter((c) => c.controlType === "Payable").map((c) => c.id));

  if (receivableIds.size === 0 && payableIds.size === 0) {
    warnings.push("No account is marked Receivable or Payable, so unpaid invoices are not in this forecast.");
  } else {
    const parties = await db.party.findMany({
      where: { companyId },
      select: { id: true, name: true, type: true, creditDays: true },
    });
    const entries = await db.journalEntry.findMany({
      where: { companyId, partyId: { not: null } },
      select: {
        reference: true, date: true, partyId: true,
        lines: { select: { debit: true, credit: true, accountId: true } },
      },
      orderBy: { date: "asc" },
    });

    const docsByParty = new Map<string, { receivable: PartyDoc[]; payable: PartyDoc[] }>();
    for (const e of entries) {
      if (!e.partyId) continue;
      let rec = 0;
      let pay = 0;
      for (const l of e.lines) {
        if (receivableIds.has(l.accountId)) rec += l.debit - l.credit;
        // A payable is a credit balance, so the sign is flipped to make "owed"
        // positive — ageParty expects debts positive whichever side they are on.
        if (payableIds.has(l.accountId)) pay += l.credit - l.debit;
      }
      if (rec === 0 && pay === 0) continue;
      const bucket = docsByParty.get(e.partyId) ?? { receivable: [], payable: [] };
      if (rec !== 0) bucket.receivable.push({ reference: e.reference, date: e.date, amount: rec });
      if (pay !== 0) bucket.payable.push({ reference: e.reference, date: e.date, amount: pay });
      docsByParty.set(e.partyId, bucket);
    }

    for (const p of parties) {
      const docs = docsByParty.get(p.id);
      if (!docs) continue;

      // The double count this report would otherwise commit. A customer hands
      // over a post-dated cheque; the invoice stays open in the ledger until it
      // clears, so the same money is both an unpaid invoice and a dated cheque.
      // Counting both would forecast twice the cash. The cheques already in
      // hand are therefore netted off the oldest invoices first — the same
      // first-in-first-out order the ageing report settles in.
      let covered = chequeInByParty.get(p.id) ?? 0;

      const rec = ageParty(docs.receivable, start, p.creditDays);
      for (const item of rec.items) {
        let due = item.outstanding;
        if (covered > 0) {
          const applied = Math.min(covered, due);
          covered = round(covered - applied);
          due = round(due - applied);
        }
        if (due <= 0) continue;
        const overdue = item.dueDate.getTime() < start.getTime();
        events.push({
          date: item.dueDate,
          amount: due,
          kind: "receivable",
          label: `Invoice ${item.reference}`,
          party: p.name,
          // Once a due date has passed, nobody knows when it will be paid. The
          // cautious view is what lets somebody see the answer without it.
          certainty: overdue ? "estimated" : "likely",
          overdue,
        });
      }

      const pay = ageParty(docs.payable, start, p.creditDays);
      for (const item of pay.items) {
        if (item.outstanding <= 0) continue;
        events.push({
          date: item.dueDate,
          amount: -item.outstanding,
          kind: "payable",
          label: `Bill ${item.reference}`,
          party: p.name,
          certainty: "likely",
          overdue: item.dueDate.getTime() < start.getTime(),
        });
      }
    }
  }

  /* ----------------------------------------------------------- retention -- */
  const retentions = await db.retention.findMany({
    where: { companyId, status: "Held" },
    select: { reference: true, direction: true, dueDate: true, amount: true, partyName: true },
    orderBy: { dueDate: "asc" },
  });
  for (const r of retentions) {
    const inbound = r.direction === "Receivable";
    events.push({
      date: r.dueDate,
      amount: inbound ? r.amount : -r.amount,
      kind: inbound ? "retention-in" : "retention-out",
      label: `Retention ${r.reference}`,
      party: r.partyName ?? undefined,
      // Retention you are owed is the most-slipped date on any UAE contract, so
      // it is treated as an estimate. Retention you hold will be asked for.
      certainty: inbound ? "estimated" : "likely",
      overdue: r.dueDate.getTime() < start.getTime(),
    });
  }

  /* ------------------------------------------------------------- payroll -- */
  const dayOfMonth = Math.min(31, Math.max(1, Math.floor(policy.payrollDayOfMonth || DEFAULT_PAY_DAY)));
  const lastRun = await db.payrollRun.findFirst({
    where: { companyId, status: { in: ["Approved", "Paid"] } },
    orderBy: { period: "desc" },
    select: { period: true, payslips: { select: { netPay: true } } },
  });
  const payrollAmount = round((lastRun?.payslips ?? []).reduce((t, p) => t + p.netPay, 0));

  if (payrollAmount > 0) {
    for (const when of payrollDates(start, horizonEnd, dayOfMonth)) {
      events.push({
        date: when,
        amount: -payrollAmount,
        kind: "payroll",
        // The amount is last month's, which is the best available guess and is
        // said out loud rather than presented as a fact.
        label: `Payroll (based on ${lastRun?.period ?? "the last run"})`,
        certainty: "likely",
      });
    }
  } else {
    warnings.push(
      "No approved payroll run yet, so wages are not in this forecast — usually the largest payment of the month.",
    );
  }

  return {
    opening,
    cashAccounts: cashRows,
    events,
    warnings,
    payroll: { amount: payrollAmount, dayOfMonth, fromPeriod: lastRun?.period ?? null },
  };
}
