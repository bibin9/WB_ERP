/**
 * The quotation, from the estimate to the customer's order (CRM-13 to 17).
 *
 * Three rules, and the third is the one that decides whether a contract is
 * reported correctly for its whole life.
 *
 * 1. Nobody sees a price management has not approved
 * --------------------------------------------------
 * A quotation is a commitment. Sending one before it has been through the
 * route is how a company finds out what it agreed to when the customer's
 * order arrives. So issuing is gated on approval, not on somebody remembering
 * to ask.
 *
 * 2. An issued quotation is not edited
 * ------------------------------------
 * The customer is holding a piece of paper. Changing the one in the system so
 * they no longer match is worse than having no system at all — every
 * conversation afterwards is two people reading different documents. A change
 * is a revision: the old one is superseded and kept.
 *
 * 3. The contract value is what the customer ORDERED, not what was quoted
 * ----------------------------------------------------------------------
 * Customers order a different number remarkably often — a rounded figure, a
 * scope they trimmed, a discount somebody agreed on the phone. Taking the
 * quoted figure because it is the one already in the system means every
 * margin report on that job is wrong from the first day, and nobody ever finds
 * out why.
 *
 * So the difference is shown, has to be acknowledged, and the job is created
 * at the ordered value.
 *
 * Not server-only: the screen warns before anything is saved.
 */

export const QUOTE_STATUSES = [
  "Draft",
  "Awaiting approval",
  "Approved",
  "Issued",
  "Accepted",
  "Declined",
  "Superseded",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_HELP: Record<string, string> = {
  Draft: "Being written. The customer has seen nothing.",
  "Awaiting approval": "With management. Nothing can go out until they have signed it.",
  Approved: "Signed off internally and ready to send to the customer.",
  Issued: "Sent. The customer is holding this, so it cannot be edited — only revised.",
  Accepted: "They ordered it. Their purchase order is recorded and it becomes a job.",
  Declined: "They said no. Record why while somebody still knows.",
  Superseded: "Replaced by a revision. Kept so the history still reads.",
};

/** Statuses where the customer has already seen the document. */
export const OUT_WITH_CUSTOMER: ReadonlySet<string> = new Set(["Issued", "Accepted", "Declined"]);

/** Statuses where nothing more will happen to it. */
export const CLOSED_QUOTES: ReadonlySet<string> = new Set(["Accepted", "Declined", "Superseded"]);

const round2 = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n: number | null | undefined) => Math.round((Number(n) || 0) * 10000) / 10000;

/* ============================================================ issuing == */

export type QuoteLike = {
  status: string;
  total: number;
  /** A Date from the database or an ISO string from a form — either will do. */
  validUntil?: string | Date | null;
};

/**
 * Whether this quotation may go to the customer (CRM-14, CRM-15).
 *
 * The gate is the approval, and it is checked here rather than trusted to a
 * button being hidden — a hidden button is a suggestion.
 */
export function checkIssue(quote: QuoteLike): { ok: true } | { ok: false; error: string } {
  if (quote.status === "Approved") return { ok: true };

  if (quote.status === "Draft") {
    return { ok: false, error: "Send it for approval first. Nothing goes to a customer unapproved." };
  }
  if (quote.status === "Awaiting approval") {
    return { ok: false, error: "Management has not signed this yet." };
  }
  if (OUT_WITH_CUSTOMER.has(quote.status)) {
    return { ok: false, error: "This has already gone to the customer. Raise a revision if it has changed." };
  }
  return { ok: false, error: `A ${quote.status.toLowerCase()} quotation cannot be issued.` };
}

/**
 * Whether this quotation may still be edited.
 *
 * Once it is out, no. The customer is holding a piece of paper, and two people
 * reading different documents is worse than no system at all.
 */
export function checkEdit(quote: QuoteLike): { ok: true } | { ok: false; error: string } {
  if (quote.status === "Draft") return { ok: true };
  if (quote.status === "Awaiting approval") {
    return { ok: false, error: "It is with management. Pull it back before changing it." };
  }
  if (quote.status === "Superseded") {
    return { ok: false, error: "This was replaced by a revision. Edit the one that replaced it." };
  }
  return {
    ok: false,
    error:
      "The customer is holding this quotation. Raise a revision rather than changing it — " +
      "two people reading different documents is worse than no system at all.",
  };
}

/* ====================================== the customer's order (CRM-17) == */

export type PoVariance = {
  quoted: number;
  ordered: number;
  /** Ordered less quoted. Negative when they cut it. */
  difference: number;
  /** As a share of what was quoted. */
  fraction: number;
  matches: boolean;
  /** Which way it went, for a sentence. */
  direction: "same" | "more" | "less";
};

/** What the customer actually ordered, against what was quoted. */
export function poVariance(quoted: number, ordered: number): PoVariance {
  const q = round2(quoted);
  const o = round2(ordered);
  const difference = round2(o - q);
  return {
    quoted: q,
    ordered: o,
    difference,
    fraction: q > 0 ? round4(difference / q) : 0,
    matches: difference === 0,
    direction: difference === 0 ? "same" : difference > 0 ? "more" : "less",
  };
}

const fmt = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Whether a customer order can be accepted, and at what value.
 *
 * A purchase order for a different figure is not an error — customers round,
 * trim scope, and agree discounts on the phone. It is a fact, and the job has
 * to be created at the figure they actually committed to. What is refused is
 * accepting the difference without noticing it, because the alternative is a
 * contract whose margin is wrong from the first day.
 */
export function checkAccept(
  quote: QuoteLike,
  orderedValue: number,
  acknowledged = false,
): { ok: true } | { ok: false; error: string } {
  if (!OUT_WITH_CUSTOMER.has(quote.status)) {
    return { ok: false, error: "This quotation has not been issued, so there is nothing for them to have ordered." };
  }
  if (quote.status === "Accepted") {
    return { ok: false, error: "Their order has already been recorded against this quotation." };
  }
  if (quote.status === "Declined") {
    return { ok: false, error: "This quotation was declined. Raise a new one if they have come back." };
  }

  const ordered = round2(orderedValue);
  if (ordered <= 0) return { ok: false, error: "Enter what their order is for." };

  const v = poVariance(quote.total, ordered);
  if (!v.matches && !acknowledged) {
    return {
      ok: false,
      error:
        `Their order is for ${fmt(v.ordered)}, which is ${fmt(v.difference)} ` +
        `${v.direction === "more" ? "more" : "less"} than the ${fmt(v.quoted)} quoted ` +
        `(${Math.abs(v.fraction * 100).toFixed(1)}%). Confirm that is right — the job will be ` +
        `created at their figure, not ours, and every margin report on it depends on getting this one right.`,
    };
  }
  return { ok: true };
}

/* ========================================================= the numbers == */

export type QuoteTotals = {
  count: number;
  outstanding: number;
  outstandingValue: number;
  accepted: number;
  acceptedValue: number;
  declined: number;
  declinedValue: number;
  /** Of those decided, the share won by value. */
  hitRate: number;
  decided: number;
};

export function summariseQuotes(quotes: { status: string; total: number; orderedValue?: number | null }[]): QuoteTotals {
  const t: QuoteTotals = {
    count: quotes.length, outstanding: 0, outstandingValue: 0,
    accepted: 0, acceptedValue: 0, declined: 0, declinedValue: 0, hitRate: 0, decided: 0,
  };

  for (const q of quotes) {
    if (q.status === "Accepted") {
      t.accepted += 1;
      // What they ordered, not what was quoted — see the note on checkAccept.
      t.acceptedValue = round2(t.acceptedValue + (Number(q.orderedValue) || Number(q.total) || 0));
    } else if (q.status === "Declined") {
      t.declined += 1;
      t.declinedValue = round2(t.declinedValue + Number(q.total));
    } else if (!CLOSED_QUOTES.has(q.status)) {
      t.outstanding += 1;
      t.outstandingValue = round2(t.outstandingValue + Number(q.total));
    }
  }

  t.decided = t.accepted + t.declined;
  const decidedValue = round2(t.acceptedValue + t.declinedValue);
  t.hitRate = decidedValue > 0 ? round4(t.acceptedValue / decidedValue) : 0;
  return t;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function quotesVerdict(totals: QuoteTotals): string {
  if (!totals.count) return "No quotations yet.";

  const parts: string[] = [];
  if (totals.outstanding > 0) {
    parts.push(`${plural(totals.outstanding, "quotation")} out, worth ${fmt(totals.outstandingValue)}.`);
  } else {
    parts.push("Nothing out with a customer.");
  }

  if (totals.decided >= 3) {
    parts.push(`${Math.round(totals.hitRate * 100)}% of the value decided so far was won.`);
  } else if (totals.decided > 0) {
    parts.push(`${plural(totals.decided, "quotation")} decided — too few to call a hit rate.`);
  }
  return parts.join(" ");
}
