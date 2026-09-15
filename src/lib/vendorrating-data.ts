import "server-only";
import { db } from "./db";
import { CLOSED } from "./purchasing";
import { quoteTotal } from "./rfq";
import { summariseVendor, type VendorRating } from "./vendorrating";

/**
 * Gathering what a supplier has actually done, so `vendorrating` can read it.
 *
 * Kept apart from the rules on purpose. The arithmetic of a defect rate is
 * worth testing on its own without a database in the way, and the queries are
 * worth changing without touching the arithmetic. This file only answers "what
 * happened"; the other one answers "what does that mean".
 *
 * Everything here is read. Nothing about a supplier's rating is stored, because
 * a stored rating is a rating that was true once — it drifts the moment an
 * order is received or a rejection recorded, and then the buyer is choosing on
 * last quarter's facts without knowing it.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** One supplier's record, read fresh. */
export async function ratingFor(companyId: string, partyId: string): Promise<VendorRating> {
  return (await ratingsFor(companyId, [partyId]))[partyId];
}

/**
 * Several suppliers at once.
 *
 * The comparison sheet needs every bidder's record on one page, and asking per
 * supplier would be one round trip each on a screen that already has enough to
 * do. The queries are the same either way — only the `in` list changes.
 */
export async function ratingsFor(
  companyId: string,
  partyIds: string[],
  asOf?: string,
): Promise<Record<string, VendorRating>> {
  const ids = [...new Set(partyIds.filter(Boolean))];
  const out: Record<string, VendorRating> = {};
  if (!ids.length) return out;

  /* ---------------------------------------------------------- delivery -- */
  const orders = await db.purchaseOrder.findMany({
    where: { companyId, partyId: { in: ids } },
    select: {
      partyId: true,
      status: true,
      expectedDate: true,
      lines: {
        select: {
          quantity: true,
          receipts: { select: { quantity: true, date: true } },
        },
      },
    },
  });

  /* ----------------------------------------------------------- quality -- */
  // Only receipts carry an inspection outcome, and only those against a
  // supplier can be attributed to one.
  const receipts = await db.stockMovement.findMany({
    where: { companyId, partyId: { in: ids }, kind: "Receipt" },
    select: { partyId: true, inspection: true },
  });

  /* ---------------------------------------- responsiveness and price ---- */
  const quoteRows = await db.rfqQuote.findMany({
    where: { rfq: { companyId }, partyId: { in: ids } },
    select: {
      partyId: true,
      rfqId: true,
      invitedAt: true,
      receivedAt: true,
      delivery: true,
      lines: { select: { rfqLineId: true, unitPrice: true } },
    },
  });

  // Every quote on the enquiries these suppliers were involved in, so "the
  // lowest" is the lowest of everybody who priced it rather than the lowest of
  // the suppliers we happen to be rating.
  const rfqIds = [...new Set(quoteRows.map((q) => q.rfqId))];
  const allQuotes = rfqIds.length
    ? await db.rfqQuote.findMany({
        where: { rfqId: { in: rfqIds } },
        select: {
          rfqId: true,
          partyId: true,
          receivedAt: true,
          delivery: true,
          lines: { select: { rfqLineId: true, unitPrice: true } },
        },
      })
    : [];
  const rfqLines = rfqIds.length
    ? await db.rfqLine.findMany({ where: { rfqId: { in: rfqIds } }, select: { id: true, quantity: true } })
    : [];
  const quantityOf = new Map(rfqLines.map((l) => [l.id, l.quantity]));

  /** Every priced quotation on an enquiry, totalled. */
  const totalsByRfq = new Map<string, { partyId: string; total: number }[]>();
  for (const q of allQuotes) {
    if (!q.receivedAt || !q.lines.length) continue;
    const total = quoteTotal({
      partyId: q.partyId,
      lines: q.lines.map((l) => ({ quantity: quantityOf.get(l.rfqLineId) ?? 0, unitPrice: l.unitPrice })),
      delivery: q.delivery,
    });
    const list = totalsByRfq.get(q.rfqId);
    if (list) list.push({ partyId: q.partyId, total });
    else totalsByRfq.set(q.rfqId, [{ partyId: q.partyId, total }]);
  }

  /* ------------------------------------------------------- assemble ----- */
  for (const partyId of ids) {
    const theirOrders = orders
      .filter((o) => o.partyId === partyId)
      .map((o) => {
        const ordered = o.lines.reduce((s, l) => s + l.quantity, 0);
        const received = o.lines.reduce(
          (s, l) => s + l.receipts.reduce((t, r) => t + r.quantity, 0),
          0,
        );
        const dates = o.lines.flatMap((l) => l.receipts.map((r) => r.date)).sort((a, b) => +a - +b);
        return {
          expectedDate: iso(o.expectedDate),
          orderedQuantity: ordered,
          receivedQuantity: received,
          lastReceiptDate: dates.length ? iso(dates[dates.length - 1]) : null,
          closed: CLOSED.has(o.status),
        };
      });

    const theirQuotes = quoteRows.filter((q) => q.partyId === partyId);

    out[partyId] = summariseVendor({
      orders: theirOrders,
      receipts: receipts.filter((r) => r.partyId === partyId),
      invites: theirQuotes.map((q) => ({
        invitedAt: iso(q.invitedAt)!,
        receivedAt: iso(q.receivedAt),
      })),
      quotes: theirQuotes.flatMap((q) => {
        const onThisRfq = totalsByRfq.get(q.rfqId) ?? [];
        const mine = onThisRfq.find((t) => t.partyId === partyId);
        if (!mine) return [];
        return [{
          total: mine.total,
          lowest: Math.min(...onThisRfq.map((t) => t.total)),
          competitors: onThisRfq.length,
        }];
      }),
      asOf,
    });
  }

  return out;
}
