/**
 * Reconciling a bank account.
 *
 * The ledger and the statement disagree most of the time, and usually for a
 * good reason: a cheque written on the 28th does not leave the account until
 * the 4th, and a transfer received today may not appear until tomorrow. The
 * point of a reconciliation is not to make them equal — it is to explain the
 * difference line by line, so that whatever is left over is a genuine problem.
 *
 * Without it the bank balance in the books can drift for a year and nobody
 * finds out until the auditor asks. It is the only routine check that proves
 * cash is real.
 *
 * The arithmetic every accountant recognises:
 *
 *     balance per the books
 *   − payments not yet on the statement
 *   + receipts not yet on the statement
 *   = balance the statement should show
 *
 * Not server-only: the screen recalculates as lines are ticked.
 */

export type RecLine = {
  /** Signed, debit positive — a receipt into the bank is positive. */
  amount: number;
  clearedOn: Date | null;
};

export type Reconciliation = {
  /** What the ledger says, as at the statement date. */
  perBooks: number;
  /** Money out that the bank has not shown yet. */
  unclearedPayments: number;
  /** Money in that the bank has not shown yet. */
  unclearedReceipts: number;
  /** What the statement ought to read, if everything else is right. */
  expectedStatement: number;
  /** Against what the statement actually reads. */
  perStatement: number | null;
  /** Anything left is unexplained, and is the reason to keep looking. */
  difference: number;
  reconciled: boolean;
  clearedCount: number;
  unclearedCount: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Work out where a reconciliation stands.
 *
 * `perBooks` is passed in rather than summed from the lines, because the ledger
 * balance includes an opening balance and anything before this statement
 * period — summing only the lines on screen would quietly reconcile against
 * the wrong number.
 */
export function reconcile(
  lines: RecLine[],
  perBooks: number,
  perStatement: number | null
): Reconciliation {
  let unclearedPayments = 0;
  let unclearedReceipts = 0;
  let clearedCount = 0;
  let unclearedCount = 0;

  for (const l of lines) {
    if (l.clearedOn) {
      clearedCount++;
      continue;
    }
    unclearedCount++;
    if (l.amount < 0) unclearedPayments += -l.amount;
    else unclearedReceipts += l.amount;
  }

  // Take out what the bank has not seen: the payments it has not paid, and the
  // receipts it has not credited.
  const expectedStatement = r2(perBooks + unclearedPayments - unclearedReceipts);
  const difference = perStatement === null ? 0 : r2(perStatement - expectedStatement);

  return {
    perBooks: r2(perBooks),
    unclearedPayments: r2(unclearedPayments),
    unclearedReceipts: r2(unclearedReceipts),
    expectedStatement,
    perStatement,
    difference,
    reconciled: perStatement !== null && Math.abs(difference) < 0.005,
    clearedCount,
    unclearedCount,
  };
}

/**
 * How long an item has sat unpresented.
 *
 * A cheque outstanding for six months is not a timing difference any more — in
 * the UAE a cheque is generally stale after six months and the bank will refuse
 * it, so it needs writing back rather than carrying.
 */
export const STALE_DAYS = 180;

export const daysOutstanding = (date: Date, asAt: Date): number =>
  Math.floor((asAt.getTime() - date.getTime()) / 86_400_000);

export const isStale = (date: Date, asAt: Date): boolean => daysOutstanding(date, asAt) > STALE_DAYS;
