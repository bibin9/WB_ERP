/**
 * Advances taken from customers and paid to suppliers.
 *
 * A mobilisation advance is normal on a UAE contract: ten or fifteen per cent
 * of the value arrives before anybody is on site, against a bank guarantee, and
 * is then recovered a slice at a time from every certificate until it is gone.
 * The same thing happens in the other direction, because a supplier will not
 * order switchgear against a promise.
 *
 * Why it is not revenue, and not a cost
 * -------------------------------------
 * Nothing has been supplied when the money moves. An advance received is owed
 * back until the work is billed; an advance paid is owed to us until the
 * supplier bills for it. Booking either through the profit and loss overstates
 * the month it arrived and understates every month that follows, and the
 * balance sheet then carries no trace of an obligation that is very real.
 *
 * Why recovery is the part that goes wrong
 * ----------------------------------------
 * The money arrives once and leaves over a year, a few per cent at a time. That
 * running figure is what lives in somebody's spreadsheet and what nobody can
 * reconcile at year end. So every set-off is a row of its own here, and what is
 * left is always derived from those rows rather than typed and adjusted. A
 * figure that is calculated cannot drift; one that is maintained by hand will.
 *
 * VAT is deliberately not handled here
 * ------------------------------------
 * Under UAE rules receiving a payment for a taxable supply is a tax point, so a
 * tax invoice is due on a taxable advance. That invoice is raised on the
 * invoicing screen like any other and then settled by the advance, which keeps
 * VAT in exactly one place — the invoice, which is also where the VAT return
 * reads it. A second VAT path through this register would be a second chance to
 * declare the same tax twice. The screen says so rather than leaving it to be
 * discovered.
 *
 * Not server-only: the form totals and warns before anything is saved.
 */

export const DIRECTIONS = ["Received", "Paid"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_HELP: Record<string, string> = {
  Received: "A customer paid us before the work was billed. We owe it back until an invoice recovers it.",
  Paid: "We paid a supplier before they billed us. They owe it to us until their invoice recovers it.",
};

/** What each side is called on the screen, so nobody has to translate. */
export const DIRECTION_LABEL: Record<string, string> = {
  Received: "From a customer",
  Paid: "To a supplier",
};

export const STATUSES = ["Open", "Recovered", "Refunded", "Written off"] as const;

export const STATUS_HELP: Record<string, string> = {
  Open: "Still has a balance to recover against future invoices.",
  Recovered: "Fully set off against invoices. Nothing left.",
  Refunded: "Given back rather than recovered — the work did not proceed.",
  "Written off": "Given up on. Taken to the profit and loss now rather than carried as a balance that will not clear.",
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type RecoveryLike = { amount: number };

export type AdvanceLike = {
  direction: string;
  amount: number;
  status: string;
  recoveries?: RecoveryLike[];
};

/** What has been set off so far. */
export function recovered(a: AdvanceLike): number {
  return round2((a.recoveries ?? []).reduce((t, r) => t + (Number(r.amount) || 0), 0));
}

/**
 * What is still to recover.
 *
 * Never negative. An over-recovery is refused when it is entered, but a figure
 * that has already gone wrong should read as nil rather than as a negative
 * balance that looks like the other party owes us.
 */
export function outstanding(a: AdvanceLike): number {
  return round2(Math.max(0, (Number(a.amount) || 0) - recovered(a)));
}

/** How an advance reads today. */
export function advanceState(a: AdvanceLike) {
  const done = recovered(a);
  const left = outstanding(a);
  const open = a.status === "Open";
  return {
    recovered: done,
    outstanding: left,
    open,
    /** Everything set off, but the row still says Open. */
    fullyRecovered: open && left === 0 && (Number(a.amount) || 0) > 0,
    /** Nothing recovered yet — the whole balance is still to come off. */
    untouched: done === 0,
    share: (Number(a.amount) || 0) > 0 ? done / Number(a.amount) : 0,
  };
}

/**
 * Whether a proposed set-off can be made.
 *
 * Recovering more than was advanced is the failure that matters: it turns a
 * liability into an apparent asset and the balance sheet stops meaning
 * anything. The refusal names the figure that is left, because the person
 * entering it is reading a certificate and not this register.
 */
export function checkRecovery(a: AdvanceLike, amount: number): { ok: true } | { ok: false; error: string } {
  const value = Number(amount) || 0;
  if (value <= 0) return { ok: false, error: "Enter the amount being recovered." };
  if (a.status !== "Open") {
    return { ok: false, error: `This advance is ${a.status.toLowerCase()}, so nothing further can be recovered against it.` };
  }
  const left = outstanding(a);
  if (left === 0) return { ok: false, error: "This advance is already fully recovered." };
  if (round2(value) > left) {
    return {
      ok: false,
      error: `That is more than is left on this advance. ${left.toLocaleString(undefined, { minimumFractionDigits: 2 })} remains.`,
    };
  }
  return { ok: true };
}

/** The slice a certificate recovers, where the contract sets a rate. */
export const recoveryOn = (certificateValue: number, percent: number): number =>
  round2(((Number(certificateValue) || 0) * (Number(percent) || 0)) / 100);

/**
 * The register in one line, per side.
 *
 * Advanced and recovered are both shown, not just the balance. "We are holding
 * 400,000 of customer money" and "we have recovered 1.6m of the 2m taken" are
 * different questions, and a single net figure answers neither.
 */
export function summarise(rows: AdvanceLike[]) {
  const blank = () => ({ count: 0, advanced: 0, recovered: 0, outstanding: 0 });
  const out = { Received: blank(), Paid: blank(), openCount: 0 };

  for (const r of rows) {
    const side = r.direction === "Paid" ? out.Paid : out.Received;
    side.count += 1;
    side.advanced += Number(r.amount) || 0;
    side.recovered += recovered(r);
    if (r.status === "Open") {
      side.outstanding += outstanding(r);
      out.openCount += 1;
    }
  }
  for (const side of [out.Received, out.Paid]) {
    side.advanced = round2(side.advanced);
    side.recovered = round2(side.recovered);
    side.outstanding = round2(side.outstanding);
  }
  return out;
}

/**
 * The sentence at the top of the screen.
 *
 * Held customer money is the figure that matters, because it is the one people
 * forget is not theirs. It leads whenever there is any.
 */
export function advancesVerdict(rows: AdvanceLike[]): string {
  const s = summarise(rows);
  if (!rows.length) return "No advances recorded. Nothing has been taken from a customer or paid to a supplier up front.";

  const held = s.Received.outstanding;
  const out = s.Paid.outstanding;
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (held === 0 && out === 0) return "Every advance on the register has been fully recovered.";
  if (held > 0 && out > 0) {
    return `Holding ${fmt(held)} of customer money still to be earned, and waiting on ${fmt(out)} paid to suppliers.`;
  }
  if (held > 0) return `Holding ${fmt(held)} of customer money that has not been billed against yet.`;
  return `Waiting on ${fmt(out)} paid to suppliers before they have billed for it.`;
}
