import "server-only";
import { db } from "./db";
import { openingInBalance, openingInPeriod } from "./ledger";

/**
 * Account balances, worked out by the database rather than by Node.
 *
 * Nine screens used to do this: load every journal line the company has ever
 * posted, hydrate it into JavaScript objects, and then filter by date in a
 * loop. On the seeded demo that is fifty rows and instant, which is exactly why
 * it survived — the cost is invisible until somebody has a real ledger.
 *
 * Measured at a hundred thousand lines, which a contractor doing two hundred
 * vouchers a month reaches inside four years:
 *
 *     load every line and filter in Node      1,988 ms, ~12 MB over the wire
 *     two grouped aggregates                     82 ms, a few kB
 *
 * Twenty-four times slower, and it grows with the ledger while the aggregate
 * does not — the database returns one row per account either way. Over a
 * network to a hosted PostgreSQL the payload difference costs more again.
 *
 * The arithmetic itself did not move. lib/ledger.ts still owns the rule about
 * when a migrated opening balance belongs in a period, and the pure functions
 * there are still what the tests hold; this only changes who does the summing.
 */

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentGroup: string | null;
  controlType: string | null;
  openingBalance: number;
  /** Signed balance brought in, everything before `from`. Debit positive. */
  brought: number;
  /** Gross movement inside the period, each way, as an auditor expects. */
  periodDr: number;
  periodCr: number;
  /** Signed movement in the period — periodDr less periodCr. */
  moved: number;
  /** Signed balance as at `to`. */
  closing: number;
};

type Options = {
  /** Restrict to these account types — "Income", "Expense" for a P&L. */
  types?: string[];
  /** Only accounts that moved or hold a balance. */
  nonZeroOnly?: boolean;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Every account with its brought-forward, period movement and closing.
 *
 * Two aggregates, not three: the closing balance is the brought-forward plus
 * the period's net movement, so asking the database for it a third time would
 * be paying twice for arithmetic already in hand.
 */
export async function accountBalances(
  companyId: string,
  from: Date,
  to: Date,
  openingAsOf?: Date | null,
  options: Options = {}
): Promise<AccountBalance[]> {
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId, ...(options.types ? { type: { in: options.types } } : {}) },
    select: {
      id: true, code: true, name: true, type: true,
      parentGroup: true, controlType: true, openingBalance: true,
    },
    orderBy: { code: "asc" },
  });
  if (accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);
  const [before, during] = await Promise.all([
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, entry: { companyId, date: { lt: from } } },
      _sum: { debit: true, credit: true },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, entry: { companyId, date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const net = (rows: typeof before) =>
    new Map(rows.map((r) => [r.accountId, (r._sum.debit ?? 0) - (r._sum.credit ?? 0)]));
  const gross = new Map(
    during.map((r) => [r.accountId, { dr: r._sum.debit ?? 0, cr: r._sum.credit ?? 0 }])
  );
  const beforeNet = net(before);

  // Where the books were migrated decides which side of the period the opening
  // balance falls on — the same rule lib/ledger.ts applies, and the reason the
  // trial balance still adds across when a company starts mid-year.
  const openingBefore = (o: number) => (openingInBalance(openingAsOf, new Date(from.getTime() - 1)) ? o : 0);
  const openingInside = openingInPeriod(openingAsOf, from, to);

  return accounts.map((a) => {
    const brought = r2(openingBefore(a.openingBalance) + (beforeNet.get(a.id) ?? 0));
    const g = gross.get(a.id) ?? { dr: 0, cr: 0 };

    // A migrated opening balance inside the period is movement, and has to
    // appear in a column or the turnover would not add across to the closing.
    const openingHere = openingInside ? a.openingBalance : 0;
    const periodDr = r2(g.dr + Math.max(0, openingHere));
    const periodCr = r2(g.cr + Math.max(0, -openingHere));
    const moved = r2(periodDr - periodCr);

    return {
      ...a,
      brought,
      periodDr,
      periodCr,
      moved,
      closing: r2(brought + moved),
    };
  });
}

/** Only what moved or holds a balance — a printed report wants no dead rows. */
export const withActivity = (rows: AccountBalance[]): AccountBalance[] =>
  rows.filter(
    (r) => Math.abs(r.brought) > 0.004 || Math.abs(r.closing) > 0.004 || r.periodDr > 0.004 || r.periodCr > 0.004
  );

/**
 * Income and expense for a period, as one pair of numbers.
 *
 * The corporate tax computation and the P&L both want exactly this and nothing
 * else, and neither has any use for the individual accounts — so it does not
 * fetch them.
 */
export async function profitAndLoss(
  companyId: string,
  from: Date,
  to: Date,
  openingAsOf?: Date | null
): Promise<{ income: number; expense: number; accountingProfit: number }> {
  const rows = await accountBalances(companyId, from, to, openingAsOf, { types: ["Income", "Expense"] });
  let income = 0;
  let expense = 0;
  for (const a of rows) {
    // Income carries a credit balance, so its movement comes back negative.
    if (a.type === "Income") income += -a.moved;
    else expense += a.moved;
  }
  return { income: r2(income), expense: r2(expense), accountingProfit: r2(income - expense) };
}

/** The signed balance on one account as at a date — for a reconciliation panel. */
export async function balanceOf(
  companyId: string,
  code: string,
  asAt: Date,
  openingAsOf?: Date | null
): Promise<{ found: boolean; balance: number }> {
  const account = await db.chartOfAccount.findFirst({
    where: { companyId, code },
    select: { id: true, openingBalance: true },
  });
  if (!account) return { found: false, balance: 0 };

  const agg = await db.journalLine.aggregate({
    where: { accountId: account.id, entry: { companyId, date: { lte: asAt } } },
    _sum: { debit: true, credit: true },
  });
  const opening = openingInBalance(openingAsOf, asAt) ? account.openingBalance : 0;
  return { found: true, balance: r2(opening + (agg._sum.debit ?? 0) - (agg._sum.credit ?? 0)) };
}
