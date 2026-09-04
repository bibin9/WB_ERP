/**
 * Balance arithmetic shared by every finance report, so the trial balance, the
 * ledger statement, the P&L and the Balance Sheet can never disagree.
 *
 * Sign convention throughout: debit positive, credit negative.
 *
 * Opening balances are treated as a single notional entry dated `openingAsOf`
 * (the day the books were migrated). That one rule gives the right answer in
 * both places:
 *   - a Balance Sheet "as at" a date includes it whenever the books opened on
 *     or before that date;
 *   - a P&L "for a period" includes it only when the migration date falls
 *     inside the period, so last year's opening figures never inflate this
 *     year's profit.
 * With no migration date recorded, opening balances are treated as brought
 * forward from before the system — carried on the Balance Sheet, never in the
 * P&L.
 */

export type LineWithDate = { debit: number; credit: number; entry: { date: Date } };
export type AccountBalances = { openingBalance: number; lines: LineWithDate[] };

const netOf = (lines: LineWithDate[]) => lines.reduce((s, l) => s + l.debit - l.credit, 0);

/** Movement posted within [from, to] inclusive. */
export function movement(account: AccountBalances, from: Date, to: Date): number {
  return netOf(account.lines.filter((l) => l.entry.date >= from && l.entry.date <= to));
}

/** Does the opening balance belong in a cumulative balance as at `to`? */
export function openingInBalance(openingAsOf: Date | null | undefined, to: Date): boolean {
  return !openingAsOf || openingAsOf <= to;
}

/** Does the opening balance belong in the movement for [from, to]? */
export function openingInPeriod(openingAsOf: Date | null | undefined, from: Date, to: Date): boolean {
  return !!openingAsOf && openingAsOf >= from && openingAsOf <= to;
}

/**
 * Cumulative balance as at `to` — what a Balance Sheet, trial balance or
 * ledger closing balance shows. Debit positive.
 */
export function balanceAsAt(account: AccountBalances, to: Date, openingAsOf?: Date | null): number {
  const opening = openingInBalance(openingAsOf, to) ? account.openingBalance : 0;
  return opening + netOf(account.lines.filter((l) => l.entry.date <= to));
}

/**
 * Movement for a period — what a P&L shows. Includes the opening balance only
 * when the books were migrated inside this period.
 */
export function periodMovement(account: AccountBalances, from: Date, to: Date, openingAsOf?: Date | null): number {
  const opening = openingInPeriod(openingAsOf, from, to) ? account.openingBalance : 0;
  return opening + movement(account, from, to);
}

/**
 * Balance brought forward at the start of a period — the opening line of a
 * ledger statement. Everything up to, but not including, `from`.
 */
export function broughtForward(account: AccountBalances, from: Date, openingAsOf?: Date | null): number {
  const before = new Date(from.getTime() - 1);
  return balanceAsAt(account, before, openingAsOf);
}
