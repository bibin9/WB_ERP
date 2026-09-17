import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import { serialised, seriesKey, isUniqueClash, type Client } from "./serialise";
import { createOrder } from "./purchase-posting";
import { checkAward, rankQuotes, MIN_VENDORS, type QuoteLike } from "./rfq";

/**
 * Running an enquiry: ask several suppliers, collect their prices, choose one,
 * and raise the order from the quotation that won.
 *
 * The last step is the point of the whole thing. If the order were typed in
 * afresh, the price on it would be whatever the buyer remembered, and the
 * comparison would be a piece of paper next to a decision rather than the
 * reason for it. Here the order is built FROM the winning quotation, so the
 * price on the order is the price the supplier quoted, and the enquiry keeps a
 * link to the order it produced.
 *
 * What is refused and why
 * -----------------------
 * Awarding before three suppliers have been asked, and awarding to anybody but
 * the cheapest without saying why. Both rules live in `rfq.ts` so a form can
 * apply them before anything is saved; both are applied again here, because a
 * rule enforced only in a browser is a suggestion.
 */

export type Failed = { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | Failed;
export type Outcome = { ok: true } | Failed;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function nextRfqNumber(companyId: string, client: Client = db): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", "RFQ");
  const last = await client.rfq.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

/* ============================================================= raising == */

export type RfqLineInput = {
  itemId?: string | null;
  description: string;
  unitCode?: string;
  quantity: number;
};

export type RfqInput = {
  companyId: string;
  raisedBy: string;
  jobId?: string | null;
  requestId?: string | null;
  date: string;
  neededBy?: string | null;
  notes?: string | null;
  lines: RfqLineInput[];
};

export async function createRfq(input: RfqInput): Promise<Result<{ rfqId: string; number: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date of the enquiry." };

  const lines = input.lines.filter((l) => (l.description ?? "").trim() && Number(l.quantity) > 0);
  if (!lines.length) return { ok: false, error: "Add at least one line saying what is being asked for." };

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }

  // Numbered while holding the series lock, so simultaneous callers queue for a
  // moment instead of colliding; the retry is for anything numbering without it.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { created, number } = await serialised([seriesKey(input.companyId, "RFQ")], async (client) => {
        const number = await nextRfqNumber(input.companyId, client);
        const created = await client.rfq.create({
        data: {
          companyId: input.companyId,
          number,
          status: "Draft",
          jobId: input.jobId ?? null,
          requestId: input.requestId ?? null,
          date: new Date(input.date + "T00:00:00.000Z"),
          neededBy: input.neededBy ? new Date(input.neededBy + "T00:00:00.000Z") : null,
          raisedBy: input.raisedBy,
          notes: input.notes ?? null,
          lines: {
            create: lines.map((l, i) => ({
              itemId: l.itemId || null,
              description: l.description.trim().slice(0, 300),
              unitCode: l.unitCode || "EA",
              quantity: Number(l.quantity),
              sortOrder: i + 1,
            })),
          },
        },
        });
        return { created, number };
      });
      return { ok: true, rfqId: created.id, number };
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/* =========================================================== inviting === */

/**
 * Ask suppliers for a price.
 *
 * Adding the same supplier again is ignored rather than refused: a buyer
 * adding a fourth name to a list of three should not be told off because one
 * of the three was already there.
 */
export async function inviteVendors(rfqId: string, partyIds: string[], _by?: string): Promise<Outcome> {
  const rfq = await db.rfq.findUnique({ where: { id: rfqId }, include: { quotes: true } });
  if (!rfq) return { ok: false, error: "Not found" };
  if (rfq.status === "Awarded") return { ok: false, error: "This enquiry has been awarded, so the list is closed." };
  if (rfq.status === "Cancelled") return { ok: false, error: "This enquiry was cancelled." };

  const wanted = [...new Set(partyIds.filter(Boolean))];
  const already = new Set(rfq.quotes.map((q) => q.partyId));
  const toAdd = wanted.filter((id) => !already.has(id));
  if (!toAdd.length && !rfq.quotes.length) return { ok: false, error: "Choose at least one supplier to ask." };

  const parties = await db.party.findMany({ where: { id: { in: toAdd }, companyId: rfq.companyId } });
  if (parties.length !== toAdd.length) return { ok: false, error: "One of those suppliers is not in this company." };

  for (const party of parties) {
    await db.rfqQuote.create({
      data: { rfqId, partyId: party.id, partyName: party.name },
    });
  }

  if (rfq.status === "Draft") await db.rfq.update({ where: { id: rfqId }, data: { status: "Sent" } });
  return { ok: true };
}

/* ======================================================= the quotation == */

export type QuotationInput = {
  rfqId: string;
  partyId: string;
  /** Price per RFQ line, keyed by the line's id. */
  prices: Record<string, number>;
  delivery?: number;
  leadTimeDays?: number | null;
  validUntil?: string | null;
  notes?: string | null;
};

export async function recordQuotation(input: QuotationInput): Promise<Outcome> {
  const rfq = await db.rfq.findUnique({ where: { id: input.rfqId }, include: { lines: true } });
  if (!rfq) return { ok: false, error: "Not found" };
  if (rfq.status === "Awarded") return { ok: false, error: "This enquiry has been awarded — prices can no longer be entered." };
  if (rfq.status === "Cancelled") return { ok: false, error: "This enquiry was cancelled." };

  const quote = await db.rfqQuote.findFirst({ where: { rfqId: input.rfqId, partyId: input.partyId } });
  if (!quote) return { ok: false, error: "That supplier was not asked for this enquiry." };

  const lineIds = new Set(rfq.lines.map((l) => l.id));
  const entries = Object.entries(input.prices).filter(([id]) => lineIds.has(id));
  if (!entries.length) return { ok: false, error: "Enter a price against at least one line." };
  if (entries.some(([, p]) => Number(p) < 0)) return { ok: false, error: "A price cannot be negative." };
  if (Number(input.delivery ?? 0) < 0) return { ok: false, error: "Delivery cannot be negative." };
  if (input.leadTimeDays != null && Number(input.leadTimeDays) < 0) {
    return { ok: false, error: "A lead time cannot be negative." };
  }

  // Re-entering a price replaces what was there. A supplier revising a quote is
  // ordinary, and keeping both would double the total.
  await db.rfqQuoteLine.deleteMany({ where: { quoteId: quote.id } });
  for (const [rfqLineId, price] of entries) {
    await db.rfqQuoteLine.create({
      data: { quoteId: quote.id, rfqLineId, unitPrice: Number(price) || 0 },
    });
  }

  await db.rfqQuote.update({
    where: { id: quote.id },
    data: {
      receivedAt: new Date(),
      delivery: Number(input.delivery) || 0,
      leadTimeDays: input.leadTimeDays == null ? null : Number(input.leadTimeDays),
      validUntil: input.validUntil ? new Date(input.validUntil + "T00:00:00.000Z") : null,
      notes: input.notes ?? null,
    },
  });

  if (rfq.status === "Sent" || rfq.status === "Draft") {
    await db.rfq.update({ where: { id: input.rfqId }, data: { status: "Quoted" } });
  }
  return { ok: true };
}

/* ======================================================= the comparison = */

/** The enquiry's quotations, shaped for `rankQuotes`. */
export async function quotesFor(rfqId: string): Promise<QuoteLike[]> {
  const rfq = await db.rfq.findUnique({
    where: { id: rfqId },
    include: { lines: true, quotes: { include: { lines: true } } },
  });
  if (!rfq) return [];

  const quantityOf = new Map(rfq.lines.map((l) => [l.id, l.quantity]));
  return rfq.quotes.map((q) => ({
    partyId: q.partyId,
    partyName: q.partyName,
    lines: q.lines.map((l) => ({ quantity: quantityOf.get(l.rfqLineId) ?? 0, unitPrice: l.unitPrice })),
    delivery: q.delivery,
    leadTimeDays: q.leadTimeDays,
    validUntil: iso(q.validUntil),
    received: !!q.receivedAt,
  }));
}

/* ========================================================== the award === */

export type AwardInput = {
  rfqId: string;
  partyId: string;
  awardedBy: string;
  /** Required when the chosen supplier is not the cheapest. */
  reason?: string | null;
  /** Where the material is to be delivered, carried onto the order. */
  storeId?: string | null;
  date?: string | null;
  notes?: string | null;
};

/**
 * Choose a supplier and raise the order from their quotation.
 *
 * The order is a draft, exactly as if it had been raised by hand: winning an
 * enquiry is not an approval, and the purchase order route still decides who
 * has to sign. Skipping that here would let a buyer commit the company's money
 * by picking a name off a comparison sheet.
 */
export async function awardRfq(input: AwardInput): Promise<Result<{ orderId: string; number: string }>> {
  const rfq = await db.rfq.findUnique({
    where: { id: input.rfqId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, quotes: { include: { lines: true } } },
  });
  if (!rfq) return { ok: false, error: "Not found" };
  if (rfq.status === "Awarded") {
    return { ok: false, error: `This enquiry was already awarded to ${rfq.awardedPartyId ? "a supplier" : "somebody"}.` };
  }
  if (rfq.status === "Cancelled") return { ok: false, error: "This enquiry was cancelled." };

  // Who made the call. The same rule a return from site follows, and it matters
  // more here: this name and the reason beside it are the whole audit record of
  // why one supplier got the work and two did not. Without it the award fell
  // through to the order and came back as a database error nobody could act on.
  if (!String(input.awardedBy ?? "").trim()) {
    return { ok: false, error: "Say who made the award. It is the only record of who chose this supplier." };
  }

  const quotes = await quotesFor(input.rfqId);
  const permitted = checkAward(quotes, input.partyId, input.reason);
  if (!permitted.ok) return permitted;

  const winner = rfq.quotes.find((q) => q.partyId === input.partyId)!;
  const priceOf = new Map(winner.lines.map((l) => [l.rfqLineId, l.unitPrice]));

  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
    ? input.date
    : new Date().toISOString().slice(0, 10);

  // Delivery rides on the order as its own line rather than being spread across
  // the others. Baking carriage into a unit rate makes the rate disagree with
  // the quotation, and the receiving clerk is the one who finds out.
  const lines = rfq.lines.map((l) => ({
    itemId: l.itemId,
    description: l.description,
    unitCode: l.unitCode,
    quantity: l.quantity,
    unitPrice: priceOf.get(l.id) ?? 0,
  }));
  if (winner.delivery > 0) {
    lines.push({
      itemId: null,
      description: "Delivery and carriage, as quoted",
      unitCode: "LOT",
      quantity: 1,
      unitPrice: winner.delivery,
    });
  }

  const order = await createOrder({
    companyId: rfq.companyId,
    raisedBy: input.awardedBy,
    partyId: input.partyId,
    jobId: rfq.jobId,
    storeId: input.storeId ?? null,
    requestId: rfq.requestId,
    date,
    expectedDate: iso(rfq.neededBy),
    notes: input.notes ?? `Awarded from enquiry ${rfq.number}`,
    lines,
  });
  if (!order.ok) return order;

  await db.rfq.update({
    where: { id: input.rfqId },
    data: {
      status: "Awarded",
      awardedPartyId: input.partyId,
      awardedAt: new Date(),
      awardedBy: input.awardedBy,
      awardReason: String(input.reason ?? "").trim() || null,
      orderId: order.orderId,
    },
  });

  return { ok: true, orderId: order.orderId, number: order.number };
}

export async function cancelRfq(rfqId: string): Promise<Outcome> {
  const rfq = await db.rfq.findUnique({ where: { id: rfqId } });
  if (!rfq) return { ok: false, error: "Not found" };
  if (rfq.status === "Awarded") {
    return { ok: false, error: "This enquiry has been awarded. Cancel the purchase order instead." };
  }
  await db.rfq.update({ where: { id: rfqId }, data: { status: "Cancelled" } });
  return { ok: true };
}

/** Enquiries still waiting on prices or a decision. */
export async function openRfqs(companyId: string) {
  return db.rfq.findMany({
    where: { companyId, status: { in: ["Draft", "Sent", "Quoted"] } },
    include: { quotes: true, lines: true },
    orderBy: [{ date: "desc" }],
  });
}

export { MIN_VENDORS, rankQuotes };
