/**
 * Asking several suppliers what they would charge, and choosing between them
 * (INV-05 RFQ, INV-06 vendor selection, INV-09 bid comparison).
 *
 * Why the document exists
 * ----------------------
 * Without it, a buyer rings the supplier they always ring. That is not
 * dishonest and it is usually not even wrong — but there is no record that
 * anybody else was asked, so a year later nobody can tell the difference
 * between a good relationship and a bad habit. On a cost-reimbursable contract
 * the client's auditor asks to see the three quotes, and "we know them" is not
 * an answer.
 *
 * So: at least three suppliers are invited before anything can be awarded.
 * Three is the number the BRD asks for and the number most main contractors
 * write into their subcontracts.
 *
 * Why the cheapest is not simply picked
 * ----------------------------------------
 * Because it is often the wrong answer. The cheapest quote can arrive three
 * weeks after site needs it, from a supplier who shorted the last two orders.
 * A buyer has to be able to choose the second cheapest.
 *
 * What the system insists on is a REASON, recorded at the moment of the
 * decision. Awarding to the lowest bidder needs no defence; awarding to anybody
 * else does, and if it is not captured while the buyer still remembers, it
 * never exists again.
 *
 * Why there is no weighted score
 * ------------------------------
 * It would be easy to multiply price by 0.5, lead time by 0.3, past
 * performance by 0.2 and print a winner. It would also be invented: nobody
 * agreed those weights, they cannot be defended to an auditor, and a number
 * that looks objective while being arbitrary is worse than no number, because
 * people stop arguing with it.
 *
 * Instead the quotes are ranked by price — the one dimension that needs no
 * interpretation — and everything else is shown beside it as a fact: how long
 * the supplier says they will take, whether that misses the date site needs,
 * whether the quote has expired, and how the supplier has actually performed.
 * The buyer decides, and says why.
 *
 * Not server-only: the comparison sheet totals and ranks before anything is
 * saved.
 */

export const RFQ_STATUSES = ["Draft", "Sent", "Quoted", "Awarded", "Cancelled"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_STATUS_HELP: Record<string, string> = {
  Draft: "Being written. No supplier has been asked for anything yet.",
  Sent: "Out with the suppliers. Waiting for their prices to come back.",
  Quoted: "At least one price is in. It can be awarded once three suppliers have been asked.",
  Awarded: "Won by one supplier, and a purchase order has been raised from their quotation.",
  Cancelled: "Called off. Nothing was ordered against it.",
};

/**
 * How many suppliers must be asked before anything can be awarded.
 *
 * Fewer than three is single-sourcing with extra steps: there is no spread to
 * compare against, so a price cannot be called competitive, only accepted.
 */
export const MIN_VENDORS = 3;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export type QuoteLineLike = {
  quantity: number;
  unitPrice: number;
};

export type QuoteLike = {
  /** Which supplier this is from. */
  partyId: string;
  partyName?: string;
  lines: QuoteLineLike[];
  /** Carriage, packing, anything charged on top of the lines. */
  delivery?: number | null;
  /** Working days from order to delivery, as the supplier states it. */
  leadTimeDays?: number | null;
  /** The last day the supplier will hold this price. ISO yyyy-mm-dd. */
  validUntil?: string | null;
  /** Whether a price has actually been received, as opposed to only invited. */
  received?: boolean;
};

/** What a quotation comes to, carriage included. */
export function quoteTotal(quote: QuoteLike): number {
  const lines = (quote.lines ?? []).reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0,
  );
  return round2(lines + (Number(quote.delivery) || 0));
}

export type RankedQuote = {
  partyId: string;
  partyName: string;
  total: number;
  /** 1 is the cheapest. Quotes with no price back are not ranked. */
  rank: number | null;
  isLowest: boolean;
  /** How much dearer than the cheapest. Nil on the cheapest itself. */
  extraOverLowest: number;
  /** As a share of the cheapest, so 0.1 is ten per cent dearer. */
  extraFraction: number;
  leadTimeDays: number | null;
  /** The supplier cannot deliver by the date site needs it. */
  late: boolean;
  /** The supplier is no longer bound by this price. */
  expired: boolean;
  received: boolean;
};

/**
 * Put the quotations in order, cheapest first, and state the trade-offs.
 *
 * A supplier who was asked but has not answered still appears, unranked and
 * marked as not received — leaving them off would make a comparison of two
 * quotes look like a comparison of two suppliers, when a third was asked and
 * stayed silent. That silence is itself worth seeing.
 */
export function rankQuotes(
  quotes: QuoteLike[],
  options: { neededBy?: string | null; asOf?: string | null } = {},
): RankedQuote[] {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);

  const rows = quotes.map((q) => {
    const total = quoteTotal(q);
    const received = q.received !== false && (q.lines ?? []).length > 0;
    const lead = q.leadTimeDays == null ? null : Number(q.leadTimeDays);

    let late = false;
    if (received && lead != null && options.neededBy) {
      const arrives = new Date(asOf + "T00:00:00.000Z");
      arrives.setUTCDate(arrives.getUTCDate() + lead);
      late = arrives > new Date(options.neededBy + "T00:00:00.000Z");
    }

    return {
      partyId: q.partyId,
      partyName: q.partyName ?? "",
      total: received ? total : 0,
      rank: null as number | null,
      isLowest: false,
      extraOverLowest: 0,
      extraFraction: 0,
      leadTimeDays: lead,
      late,
      expired: received && !!q.validUntil && q.validUntil < asOf,
      received,
    };
  });

  const priced = rows.filter((r) => r.received).sort((a, b) => a.total - b.total);
  const cheapest = priced.length ? priced[0].total : 0;
  priced.forEach((r, i) => {
    r.rank = i + 1;
    r.isLowest = r.total === cheapest;
    r.extraOverLowest = round2(r.total - cheapest);
    r.extraFraction = cheapest > 0 ? round3((r.total - cheapest) / cheapest) : 0;
  });

  // Priced quotes first in price order, then the suppliers who never replied.
  return [...priced, ...rows.filter((r) => !r.received)];
}

export type RfqTotals = {
  invited: number;
  quoted: number;
  awaiting: number;
  /** Enough suppliers were asked for this to be a competitive enquiry. */
  enoughInvited: boolean;
  lowest: number;
  highest: number;
  /** What the spread between cheapest and dearest is worth. */
  spread: number;
};

/**
 * How many DIFFERENT suppliers were asked.
 *
 * Counting rows would let the same supplier be invited three times and satisfy
 * a rule that exists to stop exactly that. The database refuses a duplicate
 * too, but the form asks this question before anything is saved, and a rule
 * enforced in only one of those two places is a rule with a way round it.
 */
const distinctVendors = (quotes: QuoteLike[]): number =>
  new Set(quotes.map((q) => q.partyId).filter(Boolean)).size;

export function summariseRfq(quotes: QuoteLike[]): RfqTotals {
  const ranked = rankQuotes(quotes);
  const priced = ranked.filter((r) => r.received);
  const totals = priced.map((r) => r.total);
  return {
    invited: distinctVendors(quotes),
    quoted: priced.length,
    awaiting: distinctVendors(quotes) - priced.length,
    enoughInvited: distinctVendors(quotes) >= MIN_VENDORS,
    lowest: totals.length ? Math.min(...totals) : 0,
    highest: totals.length ? Math.max(...totals) : 0,
    spread: totals.length ? round2(Math.max(...totals) - Math.min(...totals)) : 0,
  };
}

/**
 * Whether this enquiry may be awarded at all, and to this supplier.
 *
 * The three-supplier rule is checked on who was INVITED, not on who replied.
 * Otherwise it would punish a buyer for suppliers being slow, and worse, it
 * could be satisfied by inviting three and quietly ignoring two.
 */
export function checkAward(
  quotes: QuoteLike[],
  partyId: string,
  reason: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (distinctVendors(quotes) < MIN_VENDORS) {
    return {
      ok: false,
      error:
        `Ask at least ${MIN_VENDORS} suppliers before awarding. ` +
        `With fewer there is nothing to compare this price against, so it cannot be called competitive.`,
    };
  }

  const ranked = rankQuotes(quotes);
  const chosen = ranked.find((r) => r.partyId === partyId);
  if (!chosen) return { ok: false, error: "That supplier was not asked for this enquiry." };
  if (!chosen.received) {
    return { ok: false, error: `${chosen.partyName || "That supplier"} has not sent a price yet.` };
  }

  if (!chosen.isLowest && !String(reason ?? "").trim()) {
    const lowest = ranked.find((r) => r.isLowest);
    return {
      ok: false,
      error:
        `${chosen.partyName || "This supplier"} is ${chosen.extraOverLowest.toLocaleString()} dearer than ` +
        `${lowest?.partyName || "the lowest quote"}. Say why they are the right choice — ` +
        `a year from now this note is the only record of the decision.`,
    };
  }

  return { ok: true };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Where this enquiry stands, in a sentence.
 *
 * It leads with the thing that blocks an award, because that is what the buyer
 * is about to try to do.
 */
export function rfqVerdict(quotes: QuoteLike[], neededBy?: string | null): string {
  const t = summariseRfq(quotes);
  if (!t.invited) return "No supplier has been asked yet.";

  const parts: string[] = [];

  if (!t.enoughInvited) {
    const short = MIN_VENDORS - t.invited;
    parts.push(
      `Only ${plural(t.invited, "supplier")} asked. Ask ${plural(short, "more")} before this can be awarded.`,
    );
  }

  if (!t.quoted) {
    parts.push(`No prices back yet.`);
    return parts.join(" ");
  }

  parts.push(`${plural(t.quoted, "price")} in, from ${fmt(t.lowest)} to ${fmt(t.highest)}.`);
  if (t.spread > 0) parts.push(`The spread is ${fmt(t.spread)}.`);
  if (t.awaiting > 0) parts.push(`${plural(t.awaiting, "supplier has", "suppliers have")} not replied.`);

  const ranked = rankQuotes(quotes, { neededBy });
  const lowest = ranked.find((r) => r.isLowest);
  if (lowest?.late) {
    parts.push(`The cheapest quote arrives after site needs it, so it may not be the right one.`);
  }
  const anyExpired = ranked.some((r) => r.expired);
  if (anyExpired) parts.push(`At least one quote has expired and would need confirming.`);

  return parts.join(" ");
}
