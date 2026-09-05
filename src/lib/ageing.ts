/**
 * Outstanding and ageing.
 *
 * "How much does Al Habtoor owe us, and how old is it?" is the report an
 * accounts manager runs every week, so the arithmetic lives here on its own and
 * is tested directly.
 *
 * Settlement is FIFO — a receipt clears the oldest invoice first. That is what
 * Tally does and what every UAE client expects when they ask which invoice a
 * payment was against. Documents are aged from their own date against an "as
 * at" date, into the usual 0-30 / 31-60 / 61-90 / 90+ buckets.
 */

export type PartyDoc = {
  /** Voucher reference, for the statement. */
  reference: string;
  date: Date;
  /**
   * Net effect on the control account, debit positive.
   * For a customer: an invoice is positive, a receipt negative.
   * For a supplier the signs are reversed, so pass them already flipped.
   */
  amount: number;
  /** Payment terms at the time, in days. 0 means due immediately. */
  creditDays?: number;
};

export type OpenItem = {
  reference: string;
  date: Date;
  original: number;
  outstanding: number;
  daysOld: number;
  dueDate: Date;
  overdueDays: number;
};

export type Ageing = {
  total: number;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
  /** Anything past its due date, whatever bucket it sits in. */
  overdue: number;
  items: OpenItem[];
  /** Payments that could not be matched to an invoice — usually advances. */
  unapplied: number;
};

const DAY = 24 * 60 * 60 * 1000;
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Apply credits against debits oldest-first, then age whatever is left.
 * `asAt` is the date the report is run for, normally today.
 */
export function ageParty(docs: PartyDoc[], asAt: Date, defaultCreditDays = 0): Ageing {
  // Round every amount once, on the way in. Rounding invoices but not receipts
  // leaves fils of dust that show up as a customer owing 0.01.
  const sorted = [...docs]
    .map((d) => ({ ...d, amount: round(d.amount) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Invoices become open items; receipts are held and applied to the oldest.
  const open: OpenItem[] = [];
  let credit = 0;

  for (const d of sorted) {
    if (d.amount > 0) {
      const terms = d.creditDays ?? defaultCreditDays;
      open.push({
        reference: d.reference,
        date: d.date,
        original: round(d.amount),
        outstanding: round(d.amount),
        daysOld: 0,
        dueDate: new Date(d.date.getTime() + terms * DAY),
        overdueDays: 0,
      });
    } else if (d.amount < 0) {
      credit = round(credit - d.amount);
    }

    // Settle as soon as money arrives, so ordering matches how it happened.
    for (const item of open) {
      if (credit <= 0) break;
      if (item.outstanding <= 0) continue;
      const applied = Math.min(item.outstanding, credit);
      item.outstanding = round(item.outstanding - applied);
      credit = round(credit - applied);
    }
  }

  const remaining = open.filter((i) => i.outstanding > 0.001);
  for (const i of remaining) {
    i.daysOld = Math.max(0, Math.floor((asAt.getTime() - i.date.getTime()) / DAY));
    i.overdueDays = Math.max(0, Math.floor((asAt.getTime() - i.dueDate.getTime()) / DAY));
  }

  const bucket = (lo: number, hi: number) =>
    round(remaining.filter((i) => i.daysOld >= lo && i.daysOld <= hi).reduce((s, i) => s + i.outstanding, 0));

  return {
    total: round(remaining.reduce((s, i) => s + i.outstanding, 0) - credit),
    current: bucket(0, 30),
    d30: bucket(0, 30),
    d60: bucket(31, 60),
    d90: bucket(61, 90),
    d90plus: round(remaining.filter((i) => i.daysOld > 90).reduce((s, i) => s + i.outstanding, 0)),
    overdue: round(remaining.filter((i) => i.overdueDays > 0).reduce((s, i) => s + i.outstanding, 0)),
    items: remaining,
    unapplied: round(credit),
  };
}
