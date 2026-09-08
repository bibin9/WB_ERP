/**
 * Post-dated cheques.
 *
 * A client hands over six cheques dated monthly and they sit in a drawer until
 * each date comes round. Without a register there are two options and both are
 * wrong: post them on receipt and the bank balance is overstated for months, or
 * keep them out of the books and every one of those invoices reads as overdue
 * while nobody can see what cash is coming.
 *
 * When a cheque reaches the ledger
 * --------------------------------
 * On the day it clears, and not before. Recording one is a memo of a promise,
 * not a receipt: the money is not yours until the bank says so, and a cheque
 * that bounces should leave no trace to unwind. So the register carries the
 * forecast, the ledger carries the cash, and clearing is the single moment they
 * meet.
 *
 * The alternative — a Cheques in Hand control account debited on receipt — is
 * also correct and is what a larger finance team often runs. It costs two more
 * accounts and two more postings per cheque, and it puts a reversal in the way
 * of every bounce. Not worth it here, where the thing being replaced is a
 * spreadsheet.
 *
 * Not server-only: the form previews the status wording before saving.
 */

export const DIRECTIONS = ["Received", "Issued"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * Where a cheque can be in its life.
 *
 * Deposited is deliberately distinct from Cleared: a cheque sitting at the bank
 * for three days is neither in your drawer nor in your account, and that is
 * exactly when somebody asks where it is.
 */
export const CHEQUE_STATUSES = ["In hand", "Deposited", "Cleared", "Bounced", "Returned"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/** Statuses a cheque can still move on from. The rest are the end of the road. */
export const OPEN_STATUSES: ChequeStatus[] = ["In hand", "Deposited"];

/** What each status means, in the words a person would use. */
export const STATUS_HELP: Record<ChequeStatus, string> = {
  "In hand": "You are holding the cheque. Nothing has reached the bank.",
  Deposited: "It has gone to the bank but has not cleared yet.",
  Cleared: "The bank has paid it. This is the only status that touches the accounts.",
  Bounced: "The bank returned it unpaid. The invoice is still owed.",
  Returned: "Given back to the other party — usually replaced by a different cheque.",
};

/** Which statuses may follow which, so the register cannot record nonsense. */
export const NEXT_STATUS: Record<ChequeStatus, ChequeStatus[]> = {
  "In hand": ["Deposited", "Cleared", "Returned"],
  Deposited: ["Cleared", "Bounced", "In hand"],
  Cleared: [],
  Bounced: ["Deposited", "Returned"],
  Returned: [],
};

export const canMove = (from: string, to: string): boolean =>
  (NEXT_STATUS[from as ChequeStatus] ?? []).includes(to as ChequeStatus);

/** Only a cleared cheque moves money, and only once. */
export const settles = (status: string): boolean => status === "Cleared";

export type ChequeLike = {
  direction: string;
  chequeDate: Date;
  amount: number;
  status: string;
};

/**
 * How a cheque should be read on a given day.
 *
 * "Due" is the question the register exists to answer: a cheque dated last
 * Tuesday that is still in a drawer is money nobody banked, and it will not
 * announce itself.
 */
export function chequeState(c: ChequeLike, asAt: Date) {
  const open = OPEN_STATUSES.includes(c.status as ChequeStatus);
  const days = Math.floor((c.chequeDate.getTime() - asAt.getTime()) / 86_400_000);
  return {
    open,
    daysUntilDue: days,
    /** Bankable now, and still sitting there. */
    dueNow: open && days <= 0,
    /** Dated in the past and still not banked — the one to chase. */
    overdue: open && days < 0,
    /** Lands within the week, for the cash forecast. */
    dueThisWeek: open && days >= 0 && days <= 7,
  };
}

/** Money expected in and out over the next weeks, for the forecast. */
export function forecast(cheques: ChequeLike[], asAt: Date) {
  const buckets = { overdue: 0, week: 0, month: 0, later: 0 };
  for (const c of cheques) {
    const st = chequeState(c, asAt);
    if (!st.open) continue;
    const signed = c.direction === "Received" ? c.amount : -c.amount;
    if (st.overdue) buckets.overdue += signed;
    else if (st.daysUntilDue <= 7) buckets.week += signed;
    else if (st.daysUntilDue <= 30) buckets.month += signed;
    else buckets.later += signed;
  }
  return buckets;
}
