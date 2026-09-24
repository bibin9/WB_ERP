/**
 * Ordering material, and knowing what has actually turned up.
 *
 * Three documents, and each one exists because the next cannot be trusted
 * without it.
 *
 *   Material request   Site says what it needs and for which job. Raised by
 *                      people with no authority to commit money, which is
 *                      exactly why it is a separate document.
 *   Purchase order     The commitment. It goes through the approval route the
 *                      tenant has already configured, and until somebody with
 *                      the authority has approved it, nothing can be received
 *                      against it.
 *   Goods receipt      What actually arrived, against the order. The quantity
 *                      ordered and the quantity delivered are different numbers
 *                      remarkably often, and a system that assumes otherwise
 *                      discovers the difference at the invoice, by which time
 *                      nobody remembers.
 *
 * What is derived and what is stored
 * ----------------------------------
 * How much of an order has arrived is summed from the receipts against it, the
 * same choice the stock ledger makes. A stored "received" figure drifts the
 * moment a receipt is reversed, and an order that claims to be complete when it
 * is not is worse than one that claims nothing.
 *
 * The status follows from that sum rather than being typed. Nobody has to
 * remember to mark an order complete, and nobody can mark one complete that is
 * not.
 *
 * Not server-only: the forms total and warn before anything is saved.
 */

export const REQUEST_STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "Ordered", "Cancelled"] as const;

export const REQUEST_STATUS_HELP: Record<string, string> = {
  Draft: "Still being written. Nobody has been asked for anything.",
  Submitted: "Sent for approval. Site in-charge, then the project manager, then procurement.",
  Approved: "Approved. Procurement can now issue what is in stock or order the rest.",
  Rejected: "Turned down. Raise a new request if the work still needs it.",
  Ordered: "A purchase order has been raised against it, so the material is on its way.",
  Cancelled: "Called off before anything was ordered. Raise a new request if it is needed again.",
};

export const PO_STATUSES = [
  "Draft",
  "Awaiting approval",
  "Approved",
  "Rejected",
  "Partly received",
  "Received",
  "Cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_HELP: Record<string, string> = {
  Draft: "Still being written. The supplier has not been told anything.",
  "Awaiting approval": "Sent for approval. Nothing can be received against it yet.",
  Approved: "Approved and committed. Material can now be received against it.",
  Rejected: "Turned down. Raise a new order if it is still needed.",
  "Partly received": "Some of it has arrived. The rest is still outstanding.",
  Received: "Everything ordered has arrived.",
  Cancelled: "Called off. Nothing further can be received.",
};

/** Statuses where material may be received against the order. */
export const RECEIVABLE: ReadonlySet<string> = new Set(["Approved", "Partly received"]);

/** Statuses where the order is settled and nothing more will happen to it. */
export const CLOSED: ReadonlySet<string> = new Set(["Received", "Rejected", "Cancelled"]);

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export type OrderLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type LineTotals = { quantity: number; unitPrice: number; netAmount: number };

/** One line of an order, priced. */
export function lineTotal(line: OrderLineInput): LineTotals {
  const quantity = round3(line.quantity);
  const unitPrice = round2(line.unitPrice);
  return { quantity, unitPrice, netAmount: round2(quantity * unitPrice) };
}

/**
 * The order's value.
 *
 * No VAT. An order is a commitment to buy, not a tax document: the tax point is
 * the supplier's invoice, and putting a VAT figure on an order invites somebody
 * to reclaim tax on a document the FTA has never seen.
 */
export function orderTotal(lines: OrderLineInput[]): number {
  return round2(lines.reduce((t, l) => t + lineTotal(l).netAmount, 0));
}

export type ReceiptLike = { quantity: number };

export type LineProgress = {
  ordered: number;
  received: number;
  outstanding: number;
  /** Everything ordered on this line has arrived. */
  complete: boolean;
  /** More arrived than was ordered, which should not be possible. */
  over: boolean;
  share: number;
};

/**
 * How much of one line has arrived.
 *
 * Summed from the receipts rather than stored. Outstanding never goes negative:
 * an over-receipt is refused when it is entered, and if one ever got through it
 * should read as nothing left rather than as a negative order.
 */
export function lineProgress(orderedQuantity: number, receipts: ReceiptLike[]): LineProgress {
  const ordered = round3(orderedQuantity);
  const received = round3(receipts.reduce((t, r) => t + (Number(r.quantity) || 0), 0));
  return {
    ordered,
    received,
    outstanding: round3(Math.max(0, ordered - received)),
    complete: ordered > 0 && received >= ordered,
    over: received > ordered,
    share: ordered > 0 ? Math.min(1, received / ordered) : 0,
  };
}

export type OrderLineLike = { quantity: number; receipts: ReceiptLike[] };

/**
 * An order for things that never reach a shelf: PRO work, equipment hire,
 * subcontract labour, consultancy, camp catering.
 *
 * It matters because "received" is worked out from deliveries into a store,
 * and a service has none — so a service order approved in January was still
 * sitting under "orders to receive", counted late, the following December.
 * An order like this is closed by somebody saying the work was done, which is
 * the only evidence there is.
 *
 * Every line has to be non-stock. A mixed order — cable, and the labour to
 * pull it — is a stock order: the cable still has to arrive.
 */
export type ServiceLineLike = { item?: { isStocked: boolean } | null };

export function isServiceOrder(lines: ServiceLineLike[]): boolean {
  return lines.length > 0 && lines.every((l) => !l.item || l.item.isStocked === false);
}

/**
 * What an order's status should be, from what has actually arrived.
 *
 * Only an approved order moves on its own. A draft, a rejection or a
 * cancellation stays where it is however much material turns up, because those
 * states are decisions rather than observations.
 */
export function statusFromReceipts(current: string, lines: OrderLineLike[]): string {
  if (!RECEIVABLE.has(current)) return current;
  if (!lines.length) return current;

  const progress = lines.map((l) => lineProgress(l.quantity, l.receipts));
  if (progress.every((p) => p.complete)) return "Received";
  if (progress.some((p) => p.received > 0)) return "Partly received";
  return "Approved";
}

/**
 * Whether material may be received against this order, and how much.
 *
 * The approval gate is the reason the document exists. An order that can be
 * received before anybody approved it is a purchase order in name only.
 */
export function checkReceipt(
  status: string,
  orderedQuantity: number,
  receipts: ReceiptLike[],
  quantity: number,
  what = "this line",
): { ok: true } | { ok: false; error: string } {
  if (!RECEIVABLE.has(status)) {
    if (status === "Awaiting approval") {
      return { ok: false, error: "This order is still waiting for approval. Nothing can be received against it yet." };
    }
    if (status === "Draft") {
      return { ok: false, error: "This order has not been sent for approval yet." };
    }
    return { ok: false, error: `This order is ${status.toLowerCase()}, so nothing further can be received against it.` };
  }

  const q = round3(quantity);
  if (q <= 0) return { ok: false, error: "Enter how much arrived." };

  const p = lineProgress(orderedQuantity, receipts);
  if (p.outstanding <= 0) {
    return { ok: false, error: `Everything ordered of ${what} has already been received.` };
  }
  if (q > p.outstanding) {
    return {
      ok: false,
      error:
        `Only ${p.outstanding.toLocaleString()} of ${what} is still outstanding. ` +
        `Receive that or less, or amend the order if the supplier has sent more.`,
    };
  }
  return { ok: true };
}

export type OrderLike = {
  status: string;
  total: number;
  expectedDate?: Date | string | null;
  lines: OrderLineLike[];
};

export type OrderState = {
  /** Value of what has arrived, at the ordered price. */
  receivedValue: number;
  outstandingValue: number;
  complete: boolean;
  /** Approved, nothing arrived, and the date it was promised has passed. */
  overdue: boolean;
  daysLate: number;
};

export function orderState(order: OrderLike, asAt: Date = new Date()): OrderState {
  let receivedValue = 0;
  let outstandingValue = 0;
  let complete = order.lines.length > 0;

  for (const l of order.lines) {
    const p = lineProgress(l.quantity, l.receipts);
    const price = l.quantity > 0 ? (l as OrderLineLike & { unitPrice?: number }).unitPrice ?? 0 : 0;
    receivedValue += p.received * price;
    outstandingValue += p.outstanding * price;
    if (!p.complete) complete = false;
  }

  const due = order.expectedDate ? new Date(order.expectedDate) : null;
  const days = due ? Math.floor((asAt.getTime() - due.getTime()) / 86_400_000) : 0;

  return {
    receivedValue: round2(receivedValue),
    outstandingValue: round2(outstandingValue),
    complete,
    overdue: !!due && !complete && RECEIVABLE.has(order.status) && days > 0,
    daysLate: due && days > 0 ? days : 0,
  };
}

export type OrderSummaryRow = {
  status: string;
  total: number;
  expectedDate?: Date | string | null;
  lines: (OrderLineLike & { unitPrice: number })[];
};

export type PurchasingTotals = {
  orders: number;
  awaitingApproval: number;
  open: number;
  committed: number;
  outstandingValue: number;
  overdue: number;
};

/**
 * The register in one set of figures.
 *
 * Committed is what has been ordered and not yet arrived. It is the number a
 * contractor is usually surprised by, because it is money already promised that
 * appears nowhere in the accounts until the material lands.
 */
export function summarisePurchasing(rows: OrderSummaryRow[], asAt: Date = new Date()): PurchasingTotals {
  const t: PurchasingTotals = {
    orders: rows.length,
    awaitingApproval: 0,
    open: 0,
    committed: 0,
    outstandingValue: 0,
    overdue: 0,
  };

  for (const r of rows) {
    if (r.status === "Awaiting approval") t.awaitingApproval += 1;
    if (RECEIVABLE.has(r.status)) {
      t.open += 1;
      const s = orderState(r, asAt);
      t.outstandingValue += s.outstandingValue;
      t.committed += r.total;
      if (s.overdue) t.overdue += 1;
    }
  }
  t.outstandingValue = round2(t.outstandingValue);
  t.committed = round2(t.committed);
  return t;
}

/* ============================= what is already on the shelf (INV-02) ==== */

export type RequestLineLike = {
  itemId?: string | null;
  description: string;
  unitCode?: string;
  quantity: number;
};

export type Shortage = {
  description: string;
  unitCode: string;
  requested: number;
  onHand: number;
  short: number;
  /** Nothing in the catalogue to check against, so nothing can be said. */
  unknown: boolean;
};

/**
 * What a request asks for against what is already in stock.
 *
 * The point is not to refuse the request. Site asking for cable the store
 * already holds is not a mistake — it is the case the whole store exists for,
 * and the answer is to issue it rather than buy more. Buying what you already
 * have is the expensive failure, and it happens because the person raising the
 * request cannot see the shelf.
 *
 * A line for something not in the catalogue is reported as unknown rather than
 * as a shortage of nought. Site is allowed to ask for things nobody has set up,
 * and calling that a shortage would be a guess dressed as a fact.
 */
export function shortagesFor(
  lines: RequestLineLike[],
  onHand: Record<string, number>,
): Shortage[] {
  return lines.map((l) => {
    const requested = round3(l.quantity);
    const known = !!l.itemId && Object.prototype.hasOwnProperty.call(onHand, l.itemId);
    const have = known ? round3(onHand[l.itemId as string]) : 0;
    return {
      description: l.description,
      unitCode: l.unitCode ?? "EA",
      requested,
      onHand: have,
      short: known ? round3(Math.max(0, requested - have)) : requested,
      unknown: !known,
    };
  });
}

/** The sentence a storekeeper reads before a request is turned into an order. */
export function shortageVerdict(rows: Shortage[]): string {
  if (!rows.length) return "";

  const short = rows.filter((r) => !r.unknown && r.short > 0);
  const covered = rows.filter((r) => !r.unknown && r.short === 0);
  const unknown = rows.filter((r) => r.unknown);

  const parts: string[] = [];
  if (covered.length) {
    parts.push(
      covered.length === rows.length
        ? "Everything asked for is already in stock. Issue it rather than ordering more."
        : `${plural(covered.length, "line")} can be met from stock.`,
    );
  }
  if (short.length) parts.push(`${plural(short.length, "line")} would need buying.`);
  if (unknown.length) {
    parts.push(`${plural(unknown.length, "line is", "lines are")} not in the catalogue, so stock cannot be checked.`);
  }
  return parts.join(" ");
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The sentence at the top.
 *
 * An order nobody has approved is the thing that stops work, so it leads.
 */
export function purchasingVerdict(rows: OrderSummaryRow[], asAt: Date = new Date()): string {
  if (!rows.length) return "No purchase orders yet. Raise one when material needs ordering.";

  const t = summarisePurchasing(rows, asAt);

  if (t.awaitingApproval > 0) {
    return `${plural(t.awaitingApproval, "order is", "orders are")} waiting for approval. Nothing can be received against them until somebody approves.`;
  }
  if (t.overdue > 0) {
    return `${plural(t.overdue, "order is", "orders are")} past the date the supplier promised, with ${fmt(t.outstandingValue)} still to arrive.`;
  }
  if (t.open === 0) {
    return t.orders === 1
      ? "Nothing is on order. The one order on the register is settled."
      : `Nothing is on order. All ${t.orders} orders on the register are settled.`;
  }
  return `${fmt(t.outstandingValue)} of material is on order and has not arrived yet, across ${plural(t.open, "order")}.`;
}
