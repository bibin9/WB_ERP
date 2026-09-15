/**
 * Stock, and what it is worth.
 *
 * Material is the largest cost on a contract after labour, and until now it
 * only reached a job if somebody remembered to tag a supplier invoice by hand.
 * Everything here exists to make that automatic and, more importantly, correct:
 * a job that is charged for material it never received is as wrong as one that
 * is charged for nothing at all.
 *
 * How stock is valued
 * -------------------
 * Weighted average. Cable bought at three different prices over a month is the
 * same cable on the drum, and no storekeeper can tell you which metre came from
 * which delivery. FIFO would need the layers tracked and the issue matched
 * against them, which is more bookkeeping than a contractor's store can carry
 * and produces a number nobody can check by looking at the shelf.
 *
 * Receiving moves the average. Issuing does not: material leaves at whatever
 * the average is at that moment, and the average of what remains is unchanged.
 *
 * Why the balance is derived and never stored
 * -------------------------------------------
 * Every movement is a row, and what is on hand is the sum of them. A stored
 * balance drifts the moment a movement is reversed, and a stock figure that
 * disagrees with its own history is worse than no stock figure, because
 * somebody will trust it. This is the same choice job costing already makes
 * for its roll-ups.
 *
 * The rounding rule that matters
 * ------------------------------
 * When an issue takes the last of an item, it takes the whole remaining value,
 * not the quantity times a rounded average. Otherwise a few fils of value sits
 * on nil quantity for ever, the stock report shows a balance against nothing,
 * and no amount of counting the shelf will explain it.
 *
 * Not server-only: the forms price a movement before it is saved.
 */

/** What a movement is. The kind decides which way the stock goes. */
export const MOVEMENT_KINDS = [
  "Receipt",
  "Issue",
  "Return to store",
  "Return to supplier",
  "Adjustment in",
  "Adjustment out",
  "Transfer in",
  "Transfer out",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Kinds that add to stock. Everything else takes away. */
export const INWARD: ReadonlySet<string> = new Set([
  "Receipt",
  "Return to store",
  "Adjustment in",
  "Transfer in",
]);

export const MOVEMENT_HELP: Record<string, string> = {
  Receipt: "Material arriving from a supplier.",
  Issue: "Material leaving the store for a job. This is what puts material cost on that job.",
  "Return to store": "Material coming back unused from a job. The job is credited with what it cost.",
  "Return to supplier": "Material going back to the supplier, usually wrong or damaged.",
  "Adjustment in": "Stock found that the system did not know about — normally after a count.",
  "Adjustment out": "Stock gone that the system still thinks is there. Damage, loss, or a count that came up short.",
  "Transfer in": "Arriving from another store of ours.",
  "Transfer out": "Going to another store of ours.",
};

/** Whether a movement adds to or takes from stock. */
export const isInward = (kind: string): boolean => INWARD.has(kind);

/** +1 for a movement that adds stock, -1 for one that removes it. */
export const direction = (kind: string): 1 | -1 => (isInward(kind) ? 1 : -1);

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** Quantities carry more precision than money: 0.001 of a tonne is a kilogram. */
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export const INSPECTION_STATES = ["Pending", "Accepted", "Rejected"] as const;

export const INSPECTION_HELP: Record<string, string> = {
  Pending: "On the shelf but not yet looked at. It cannot be issued until QA/QC passes it.",
  Accepted: "Inspected and passed. Free to issue.",
  Rejected: "Failed inspection. It stays on the shelf until it goes back to the supplier, and cannot be issued.",
};

export type MovementLike = {
  kind: string;
  quantity: number;
  /** The value of this movement, always positive; the kind decides the sign. */
  value: number;
  /** QA/QC outcome on a receipt. Null where inspection does not apply. */
  inspection?: string | null;
};

export type StockBalance = {
  quantity: number;
  value: number;
  /** Value divided by quantity, or nought when there is nothing on hand. */
  averageCost: number;
  /**
   * What can actually be issued (INV-11).
   *
   * Material waiting on QA/QC, and material QA/QC turned down, is on the shelf
   * and owned by the company — so it is in `quantity` and in `value`, and the
   * stock report and the ledger agree. It is not usable, and that is a
   * different question from whether it is there.
   *
   * Conflating the two is how uncertified material gets welded into a line.
   */
  usable: number;
  /** On the shelf, waiting on an inspector. */
  awaitingInspection: number;
  /** On the shelf, failed, and due back to the supplier. */
  rejected: number;
};

/**
 * What is on hand, from the movements themselves.
 *
 * Quantity and value are summed with the same signs, so the two can never tell
 * different stories about the same shelf.
 */
export function balanceOf(movements: MovementLike[]): StockBalance {
  let quantity = 0;
  let value = 0;
  let awaitingInspection = 0;
  let rejected = 0;

  for (const m of movements) {
    const sign = direction(m.kind);
    const q = Number(m.quantity) || 0;
    quantity += sign * q;
    value += sign * (Number(m.value) || 0);

    // Only a receipt carries an inspection outcome. A return to the supplier
    // takes the failed material away again, and its own sign does that.
    if (m.inspection === "Pending") awaitingInspection += sign * q;
    else if (m.inspection === "Rejected") rejected += sign * q;
  }
  quantity = round3(quantity);
  value = round2(value);
  awaitingInspection = round3(Math.max(0, awaitingInspection));
  rejected = round3(Math.max(0, rejected));

  // Nothing on the shelf is worth nothing. Anything else is drift, and it is
  // better corrected here than left to be discovered on a stock report.
  if (quantity === 0) value = 0;

  return {
    quantity,
    value,
    averageCost: quantity > 0 ? round2(value / quantity) : 0,
    usable: round3(Math.max(0, quantity - awaitingInspection - rejected)),
    awaitingInspection,
    rejected,
  };
}

export type PricedMovement = {
  quantity: number;
  unitCost: number;
  value: number;
};

/**
 * Price a receipt.
 *
 * The cost is what was paid, so the value follows straight from it. This is the
 * only kind of movement whose price comes from outside.
 */
export function priceReceipt(quantity: number, unitCost: number): PricedMovement {
  const q = round3(quantity);
  const c = round2(unitCost);
  return { quantity: q, unitCost: c, value: round2(q * c) };
}

/**
 * Price an issue against what is on hand.
 *
 * Material leaves at the average of what is there. When it takes the last of
 * the stock it takes the whole remaining value, so nothing is left stranded
 * against a nil quantity — see the note at the top of this file.
 */
export function priceIssue(quantity: number, balance: StockBalance): PricedMovement {
  const q = round3(quantity);
  if (q <= 0) return { quantity: 0, unitCost: 0, value: 0 };

  const takesEverything = q >= balance.quantity;
  const value = takesEverything ? round2(balance.value) : round2(q * balance.averageCost);
  return {
    quantity: q,
    unitCost: q > 0 ? round2(value / q) : 0,
    value,
  };
}

/**
 * Whether an issue can be made.
 *
 * Negative stock is refused rather than allowed and reported. A store that can
 * go negative stops being a record of what is on the shelf, and the first thing
 * anybody does with a negative balance is stop trusting the whole report.
 */
export function checkIssue(
  quantity: number,
  balance: StockBalance,
  itemName = "this item",
): { ok: true } | { ok: false; error: string } {
  const q = round3(quantity);
  if (q <= 0) return { ok: false, error: "Enter how much is being issued." };
  if (balance.quantity <= 0) {
    return { ok: false, error: `There is none of ${itemName} in this store. Receive it first, or issue from the store that has it.` };
  }

  /**
   * Read against what is usable, not what is present (INV-11).
   *
   * Material on the shelf that QA/QC has not passed cannot be issued, and the
   * refusal has to say why — otherwise somebody stares at a shelf holding two
   * hundred metres of cable while the system insists there is none.
   */
  if (q > balance.usable) {
    if (balance.awaitingInspection > 0 || balance.rejected > 0) {
      const held: string[] = [];
      if (balance.awaitingInspection > 0) held.push(`${balance.awaitingInspection.toLocaleString()} waiting on inspection`);
      if (balance.rejected > 0) held.push(`${balance.rejected.toLocaleString()} rejected and due back to the supplier`);
      return {
        ok: false,
        error:
          `Only ${balance.usable.toLocaleString()} of ${itemName} can be issued. ` +
          `There is more on the shelf — ${held.join(", ")} — but it is not free to use yet.`,
      };
    }
    return {
      ok: false,
      error: `Only ${balance.quantity.toLocaleString()} of ${itemName} is in this store. Issue that or less, or receive more first.`,
    };
  }
  return { ok: true };
}

/**
 * What a receipt does to the average.
 *
 * Kept separate from the balance so a form can show the effect before anything
 * is saved: a delivery at twice the usual price moves the value of everything
 * already on the shelf, and that is worth seeing beforehand.
 */
export function averageAfterReceipt(balance: StockBalance, quantity: number, unitCost: number): number {
  const received = priceReceipt(quantity, unitCost);
  const q = round3(balance.quantity + received.quantity);
  if (q <= 0) return 0;
  return round2((balance.value + received.value) / q);
}

export type ItemStock = {
  itemId: string;
  code: string;
  name: string;
  unitCode: string;
  reorderLevel: number;
  balance: StockBalance;
};

/** Items at or below the level somebody set for reordering. */
export const needsReorder = (s: ItemStock): boolean =>
  s.reorderLevel > 0 && s.balance.quantity <= s.reorderLevel;

export type StockTotals = {
  items: number;
  /** Items with stock on hand. */
  stocked: number;
  value: number;
  belowReorder: number;
  /** Items whose balance has gone negative, which should never happen. */
  negative: number;
};

export function summariseStock(rows: ItemStock[]): StockTotals {
  const t: StockTotals = { items: rows.length, stocked: 0, value: 0, belowReorder: 0, negative: 0 };
  for (const r of rows) {
    if (r.balance.quantity > 0) t.stocked += 1;
    if (r.balance.quantity < 0) t.negative += 1;
    if (needsReorder(r)) t.belowReorder += 1;
    t.value += r.balance.value;
  }
  t.value = round2(t.value);
  return t;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence at the top of the stock screen.
 *
 * A negative balance outranks everything, because it means the record and the
 * shelf have already stopped agreeing and every figure below it is suspect.
 */
export function stockVerdict(rows: ItemStock[]): string {
  if (!rows.length) return "No items yet. Add what you buy and keep in the store, then record what arrives.";

  const t = summariseStock(rows);
  if (t.negative > 0) {
    const which = t.negative === 1 ? "One item shows" : `${t.negative} items show`;
    return `${which} less than nothing in stock. Something was issued that was never received, so count the shelf and adjust before trusting anything else here.`;
  }
  if (t.stocked === 0) return `${plural(t.items, "item is", "items are")} set up, and none has any stock on hand.`;
  if (t.belowReorder > 0) {
    const which = t.belowReorder === 1 ? "1 item is" : `${t.belowReorder} items are`;
    return `${fmt(t.value)} of stock on hand across ${plural(t.stocked, "item")}. ${which} at or below the reorder level.`;
  }
  return `${fmt(t.value)} of stock on hand across ${plural(t.stocked, "item")}.`;
}
