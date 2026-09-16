/**
 * The priced lines a customer sees on a quotation.
 *
 * An estimate knows what each line costs and what the whole job sells for. It
 * does not know a selling rate per line, and a quotation cannot go out without
 * one: the customer checks quantity × rate against the amount on every line,
 * and once the order is placed that rate is what every variation is priced at.
 *
 * So each line's rate is its unit cost carried up by the same factor the
 * estimate applied to the whole — overheads and margin spread over the work in
 * proportion to what it costs — rounded to the fils. The amount is then that
 * rate times the quantity, and the total is the sum of the amounts. Every line
 * multiplies out, and the total is the one printed.
 *
 * The price of that honesty is a rounding difference against the estimate's
 * own figure: at most half a fils per unit quoted. It is reported rather than
 * hidden, so nobody finds it by adding up a printout.
 *
 * Not server-only, and no database: pure arithmetic, tested on its own.
 */

export type QuoteLineInput = {
  ref?: string | null;
  description: string;
  unit: string;
  /** 1 on a lump sum, however it was typed. */
  quantity: number;
  /** Direct cost of one unit, before overheads and margin. */
  unitCost: number;
};

export type QuoteLine = {
  ref: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
};

export type PricedLines = {
  lines: QuoteLine[];
  /** The sum of the printed amounts. This is what the quotation is for. */
  total: number;
  /** total minus the estimate's selling price. Small, and never hidden. */
  roundingDifference: number;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Price the lines of an estimate for a quotation.
 *
 * @param direct the estimate's direct cost across all lines
 * @param sell   what the estimate says the whole job sells for
 */
export function priceLines(inputs: QuoteLineInput[], direct: number, sell: number): PricedLines {
  // With nothing costed there is no factor to apply, and nothing to quote.
  const factor = direct > 0 ? sell / direct : 0;

  const lines = inputs.map((l) => {
    const quantity = Number(l.quantity) || 0;
    const rate = round2((Number(l.unitCost) || 0) * factor);
    return {
      ref: l.ref ? String(l.ref) : null,
      description: String(l.description ?? ""),
      unit: String(l.unit ?? ""),
      quantity,
      rate,
      amount: round2(rate * quantity),
    };
  });

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, total, roundingDifference: round2(total - sell) };
}

/**
 * Read a snapshot back, or nothing if there is none or it is not readable.
 *
 * Quotations raised before snapshots existed have none. The caller decides
 * what to do about that; this only refuses to invent lines from bad JSON.
 */
export function readSnapshot(json: string | null | undefined): QuoteLine[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((l) => ({
      ref: l.ref ?? null,
      description: String(l.description ?? ""),
      unit: String(l.unit ?? ""),
      quantity: Number(l.quantity) || 0,
      rate: Number(l.rate) || 0,
      amount: Number(l.amount) || 0,
    }));
  } catch {
    return null;
  }
}
