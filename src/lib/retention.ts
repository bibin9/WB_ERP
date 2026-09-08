/**
 * Retention held against a contract.
 *
 * Five or ten per cent is taken out of every certified payment and comes back
 * in two pieces: half at practical completion, half once the defects liability
 * period ends — a year later in most UAE contracts. It runs both ways at once,
 * because the client holds it from you while you hold it from your own
 * subcontractors.
 *
 * When it reaches the ledger
 * --------------------------
 * It is already there. The certificate that withheld it posted the split when
 * it was entered, so recording an entry here is not a posting — it is the note
 * of what that money is, whose it is and when it can be asked for, which is the
 * part that was living in a spreadsheet.
 *
 * Releasing is the posting: it moves the amount out of retention and into the
 * ordinary receivable or payable, so it appears in ageing and gets chased or
 * paid like anything else. That is the moment the two records have to agree,
 * which is why the screen reconciles the register against the account balance.
 *
 * Not server-only: the form previews the wording before saving.
 */

export const DIRECTIONS = ["Receivable", "Payable"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Where retention lands in the chart, each side of the contract. */
export const RETENTION_RECEIVABLE_CODE = "1160";
export const RETENTION_PAYABLE_CODE = "2200";
export const AR_CODE = "1100";
export const AP_CODE = "2000";

/**
 * The two tranches a UAE contract almost always uses, plus an escape hatch.
 *
 * Naming them matters: "half at completion, half a year later" is the deal, and
 * a register that only knows a date cannot tell you which half is which when a
 * client queries it.
 */
export const STAGES = ["Practical completion", "Defects liability", "Other"] as const;

export const STAGE_HELP: Record<string, string> = {
  "Practical completion": "The first half, released when the works are handed over.",
  "Defects liability": "The second half, released when the maintenance period ends — usually a year after handover.",
  Other: "Anything the contract words differently.",
};

export const STATUSES = ["Held", "Released", "Written off"] as const;

export const STATUS_HELP: Record<string, string> = {
  Held: "Still with the other party. Nothing has moved.",
  Released: "Moved into the ordinary receivable or payable, so it is now chased or paid like any other balance.",
  "Written off": "Given up on. The cost is taken now rather than carried as an asset that will not arrive.",
};

export type RetentionLike = {
  direction: string;
  dueDate: Date;
  amount: number;
  status: string;
};

/** Whether an entry is still outstanding, and how its date reads today. */
export function retentionState(r: RetentionLike, asAt: Date) {
  const held = r.status === "Held";
  const days = Math.floor((r.dueDate.getTime() - asAt.getTime()) / 86_400_000);
  return {
    held,
    daysUntilDue: days,
    /** Askable for now, and still not asked for. */
    releasable: held && days <= 0,
    /** Past its date by a margin — on a year-long hold, easy to miss entirely. */
    overdue: held && days < 0,
    dueSoon: held && days > 0 && days <= 60,
  };
}

/** What is held, split by when it can be asked for. */
export function ageing(rows: RetentionLike[], asAt: Date) {
  const bucket = { releasable: 0, soon: 0, later: 0, total: 0 };
  for (const r of rows) {
    const st = retentionState(r, asAt);
    if (!st.held) continue;
    bucket.total += r.amount;
    if (st.releasable) bucket.releasable += r.amount;
    else if (st.dueSoon) bucket.soon += r.amount;
    else bucket.later += r.amount;
  }
  return bucket;
}

/** Retention on an amount, rounded the way the certificate would show it. */
export const retentionOn = (value: number, percent: number): number =>
  Math.round(((Number(value) || 0) * (Number(percent) || 0)) / 100 * 100) / 100;
