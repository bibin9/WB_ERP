/**
 * How a supplier has actually performed (INV-21, and the leg of INV-06 that
 * asks for past performance).
 *
 * Nothing here is typed in by anybody. Every figure is read back out of what
 * already happened: orders against their promised dates, deliveries against
 * QA/QC, enquiries against whether the supplier bothered to reply. A rating
 * somebody enters by hand is a rating of the last conversation they had, and
 * it is always five stars for whoever they like.
 *
 * Four measures, and no single score
 * ----------------------------------
 * The same argument as the bid comparison, for the same reason: combining
 * on-time delivery with defect rate needs weights nobody agreed, and a number
 * that looks objective while being invented is worse than none because people
 * stop arguing with it. So the four are reported side by side, each with the
 * count it is out of, and the buyer reads them.
 *
 * Why the denominator is always shown
 * -----------------------------------
 * This is the part that matters most, and the part that is usually got wrong.
 * A supplier with one order that came a day late is not "0% on time" in any
 * sense worth acting on, but a table that prints 0% next to a supplier with
 * forty orders at 0% invites exactly that. So every measure carries how many
 * it is out of, and below `MIN_HISTORY` the module refuses to characterise the
 * supplier at all — it says there is not enough history, which is true, rather
 * than a percentage, which is not.
 *
 * Dropping a supplier over a sample of one is a real thing that happens, and
 * it is usually irreversible: nobody re-approves a vendor somebody else
 * blacklisted.
 *
 * Not server-only: the comparison sheet shows these beside the prices.
 */

/**
 * How much history is needed before a measure means anything.
 *
 * Three is low, deliberately. It is not a statistical claim — it is the point
 * below which a single bad week decides the whole figure, and a buyer reading
 * "2 of 2 late" should be told that is two orders rather than shown 0%.
 */
export const MIN_HISTORY = 3;

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const pct = (n: number, d: number) => (d > 0 ? round3(n / d) : 0);

/* ============================================================ delivery == */

export type OrderPerformanceLike = {
  /** What the supplier promised. An order without one cannot be judged late. */
  expectedDate?: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  /** The date the last receipt against it landed. Null if nothing arrived. */
  lastReceiptDate?: string | null;
  /** Whether the order is finished with, one way or another. */
  closed: boolean;
};

export type DeliveryRating = {
  /** Orders this could be judged on at all. */
  considered: number;
  /** Orders with no promised date, so excluded rather than counted as on time. */
  undated: number;
  onTime: number;
  inFull: number;
  /** On time AND in full — the only one of the three worth quoting alone. */
  otif: number;
  onTimeRate: number;
  inFullRate: number;
  otifRate: number;
  enough: boolean;
};

/**
 * On time, in full.
 *
 * An order with no promised date is excluded, not counted as on time. Counting
 * it as on time would make the suppliers whose paperwork is worst look best,
 * which is precisely backwards.
 *
 * An order still open is only late once its promised date has passed; until
 * then it is simply not finished, and judging it would mark a supplier down for
 * an order they still have time to deliver.
 */
export function rateDelivery(orders: OrderPerformanceLike[], asOf?: string): DeliveryRating {
  const today = asOf ?? new Date().toISOString().slice(0, 10);

  let considered = 0;
  let undated = 0;
  let onTime = 0;
  let inFull = 0;
  let otif = 0;

  for (const o of orders) {
    const due = o.expectedDate ?? null;
    if (!due) {
      undated += 1;
      continue;
    }
    // Still running and not yet due: nothing to judge.
    if (!o.closed && due >= today) continue;

    considered += 1;

    const full = round3(o.receivedQuantity) >= round3(o.orderedQuantity);
    // Nothing arrived at all, and the date has gone: late by definition.
    const punctual = !!o.lastReceiptDate && o.lastReceiptDate <= due && full;

    if (punctual) onTime += 1;
    if (full) inFull += 1;
    if (punctual && full) otif += 1;
  }

  return {
    considered,
    undated,
    onTime,
    inFull,
    otif,
    onTimeRate: pct(onTime, considered),
    inFullRate: pct(inFull, considered),
    otifRate: pct(otif, considered),
    enough: considered >= MIN_HISTORY,
  };
}

/* ============================================================= quality == */

export type InspectionLike = { inspection?: string | null };

export type QualityRating = {
  inspected: number;
  rejected: number;
  defectRate: number;
  enough: boolean;
};

/**
 * How often what they sent failed inspection.
 *
 * Only inspected deliveries count. Material that never needed QA/QC says
 * nothing about quality either way, and folding it in would dilute a real
 * defect rate towards zero for any supplier who mostly sends consumables.
 */
export function rateQuality(receipts: InspectionLike[]): QualityRating {
  const judged = receipts.filter((r) => r.inspection === "Accepted" || r.inspection === "Rejected");
  const rejected = judged.filter((r) => r.inspection === "Rejected").length;
  return {
    inspected: judged.length,
    rejected,
    defectRate: pct(rejected, judged.length),
    enough: judged.length >= MIN_HISTORY,
  };
}

/* ====================================================== responsiveness == */

export type InviteLike = {
  /** When they were asked. ISO yyyy-mm-dd. */
  invitedAt: string;
  /** When their price came back, or null if it never did. */
  receivedAt?: string | null;
};

export type ResponseRating = {
  asked: number;
  replied: number;
  replyRate: number;
  /** Median working days to reply, over the ones they did reply to. */
  medianDays: number | null;
  enough: boolean;
};

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(to + "T00:00:00.000Z").getTime() - new Date(from + "T00:00:00.000Z").getTime()) / 86400000,
  );

/**
 * Whether they answer, and how quickly.
 *
 * The median rather than the average, because one supplier who took two months
 * to reply once would otherwise swamp a year of same-day answers, and the
 * number would describe that single incident rather than the supplier.
 */
export function rateResponsiveness(invites: InviteLike[]): ResponseRating {
  const replied = invites.filter((i) => !!i.receivedAt);
  const days = replied
    .map((i) => daysBetween(i.invitedAt, i.receivedAt!))
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  let median: number | null = null;
  if (days.length) {
    const mid = Math.floor(days.length / 2);
    median = days.length % 2 ? days[mid] : round3((days[mid - 1] + days[mid]) / 2);
  }

  return {
    asked: invites.length,
    replied: replied.length,
    replyRate: pct(replied.length, invites.length),
    medianDays: median,
    enough: invites.length >= MIN_HISTORY,
  };
}

/* ============================================================== price === */

export type QuoteOutcomeLike = {
  /** What this supplier quoted. */
  total: number;
  /** The lowest quote on that same enquiry. */
  lowest: number;
  /** How many suppliers priced it, so a one-horse race can be excluded. */
  competitors: number;
};

export type PriceRating = {
  compared: number;
  timesLowest: number;
  lowestRate: number;
  /** Average fraction above the lowest, so 0.08 is eight per cent dearer. */
  averageAboveLowest: number;
  enough: boolean;
};

/**
 * How their prices have compared when there was something to compare against.
 *
 * An enquiry where they were the only supplier to reply is thrown out. Being
 * the cheapest of one is not a fact about the supplier, and counting it would
 * reward whoever happens to quote when nobody else does.
 */
export function ratePrice(quotes: QuoteOutcomeLike[]): PriceRating {
  const real = quotes.filter((q) => q.competitors >= 2 && q.lowest > 0);
  const timesLowest = real.filter((q) => round3(q.total) <= round3(q.lowest)).length;
  const above = real.map((q) => (q.total - q.lowest) / q.lowest);
  return {
    compared: real.length,
    timesLowest,
    lowestRate: pct(timesLowest, real.length),
    averageAboveLowest: real.length ? round3(above.reduce((s, n) => s + n, 0) / real.length) : 0,
    enough: real.length >= MIN_HISTORY,
  };
}

/* ============================================================ together == */

export type VendorRating = {
  delivery: DeliveryRating;
  quality: QualityRating;
  response: ResponseRating;
  price: PriceRating;
  /** Whether anything at all can be said about this supplier yet. */
  anyHistory: boolean;
};

export function summariseVendor(input: {
  orders: OrderPerformanceLike[];
  receipts: InspectionLike[];
  invites: InviteLike[];
  quotes: QuoteOutcomeLike[];
  asOf?: string;
}): VendorRating {
  const delivery = rateDelivery(input.orders, input.asOf);
  const quality = rateQuality(input.receipts);
  const response = rateResponsiveness(input.invites);
  const price = ratePrice(input.quotes);
  return {
    delivery,
    quality,
    response,
    price,
    anyHistory: delivery.enough || quality.enough || response.enough || price.enough,
  };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const asPct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * What is known about this supplier, in a sentence.
 *
 * Leads with what there is enough of to say, and says plainly when there is
 * not. It never prints a percentage it does not have the history to stand
 * behind, because that percentage is the one somebody acts on.
 */
export function vendorVerdict(rating: VendorRating): string {
  const parts: string[] = [];

  if (rating.delivery.enough) {
    parts.push(
      `${asPct(rating.delivery.otifRate)} on time and in full over ${plural(rating.delivery.considered, "order")}.`,
    );
  } else if (rating.delivery.considered > 0) {
    parts.push(
      `Only ${plural(rating.delivery.considered, "completed order")} to judge delivery on — too few to call.`,
    );
  }

  if (rating.quality.enough) {
    parts.push(
      rating.quality.rejected === 0
        ? `Nothing rejected in ${plural(rating.quality.inspected, "inspected delivery", "inspected deliveries")}.`
        : `${asPct(rating.quality.defectRate)} of ${plural(rating.quality.inspected, "inspected delivery", "inspected deliveries")} rejected.`,
    );
  }

  if (rating.response.enough) {
    const speed = rating.response.medianDays == null
      ? ""
      : `, typically in ${plural(rating.response.medianDays, "day")}`;
    parts.push(`Replied to ${rating.response.replied} of ${plural(rating.response.asked, "enquiry", "enquiries")}${speed}.`);
  }

  if (rating.price.enough) {
    parts.push(
      rating.price.timesLowest === rating.price.compared
        ? `Cheapest on all ${plural(rating.price.compared, "comparison")}.`
        : `Cheapest on ${rating.price.timesLowest} of ${plural(rating.price.compared, "comparison")}, ` +
          `averaging ${asPct(rating.price.averageAboveLowest)} above the lowest.`,
    );
  }

  if (!parts.length) {
    return "Not enough history with this supplier yet to say anything useful.";
  }
  return parts.join(" ");
}

/**
 * A short label for a table column, or nothing when it would mislead.
 *
 * Returns null rather than "0%" or "n/a" below the history threshold, so a
 * caller has to decide what to show instead of accidentally printing a figure
 * that reads as a judgement.
 */
export function deliveryLabel(rating: DeliveryRating): string | null {
  if (!rating.enough) return null;
  return `${asPct(rating.otifRate)} OTIF (${rating.considered})`;
}
