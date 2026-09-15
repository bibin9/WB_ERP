/**
 * Pricing the work (CRM-05 bill of quantities and takeoff, CRM-06 cost
 * build-up, CRM-07 bidding units).
 *
 * Four rules, and each one is a way contractors lose money that nobody
 * notices until the job is finished.
 *
 * 1. Margin is not markup
 * -----------------------
 * A twenty per cent markup gives a 16.67 per cent margin. They are different
 * numbers and estimators say "twenty per cent" meaning either. On a two
 * million dirham job the difference is sixty-seven thousand dirhams of profit
 * that was never there.
 *
 * So both are always computed and both are always shown. Nothing here takes a
 * single number called "percent" and hopes.
 *
 * 2. Overheads go on before the margin
 * ------------------------------------
 * Direct cost, then indirects, THEN margin. Apply the margin first and the
 * overheads come straight back out of it — the estimate still shows twenty per
 * cent and the job returns four.
 *
 * 3. The rate comes from the build-up, never typed
 * ------------------------------------------------
 * Material, labour hours at a rate, plant hours at a rate, subcontract. If an
 * estimator can type a rate over the top, the build-up is decoration and
 * nobody can answer the only question that matters six months later: why is
 * this line losing money.
 *
 * 4. Wastage is part of the takeoff
 * ---------------------------------
 * A hundred metres of tray does not need a hundred metres of tray. It needs a
 * hundred and five, and the offcuts are real money already proven on the
 * returns note. An estimate with no wastage in it is short before work starts.
 *
 * Not server-only: the estimate screen totals as it is typed.
 */

export const BID_UNITS = [
  "Tonne",
  "Metre",
  "Square metre",
  "Cubic metre",
  "Piece",
  "Lump sum",
] as const;
export type BidUnit = (typeof BID_UNITS)[number];

export const BID_UNIT_HELP: Record<string, string> = {
  Tonne: "Priced by weight — structural steel, rebar, plate.",
  Metre: "Priced by length — cable, tray, pipe, conduit.",
  "Square metre": "Priced by area — cladding, painting, flooring.",
  "Cubic metre": "Priced by volume — concrete, excavation, fill.",
  Piece: "Priced each — panels, luminaires, valves, supports.",
  "Lump sum": "One price for the whole package, whatever it takes. There is no quantity.",
};

/**
 * A lump sum has no quantity.
 *
 * Asking for one invites somebody to enter 1 and then multiply, which reads as
 * a rate and gets renegotiated as a rate. The whole point of a lump sum is
 * that the customer is buying an outcome, not a measurement.
 */
export const isLumpSum = (unit: string): boolean => unit === "Lump sum";

/**
 * Rounding that takes what a form actually gives it.
 *
 * Nullable on purpose: every one of these is fed straight from a database
 * column or a form field that may be empty, and `Number(n) || 0` already
 * handles it. A signature saying `number` would only push the same coalescing
 * out to a dozen call sites.
 */
type Maybe = number | null | undefined;
const round2 = (n: Maybe) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n: Maybe) => Math.round((Number(n) || 0) * 1000) / 1000;
const round4 = (n: Maybe) => Math.round((Number(n) || 0) * 10000) / 10000;

/* ================================================= markup versus margin == */

/**
 * The margin a markup actually produces.
 *
 * markup 0.20 → margin 0.1667. The number everybody quotes and the number the
 * accounts will show, and they are not the same.
 */
export function markupToMargin(markup: number): number {
  const m = Number(markup) || 0;
  if (m <= -1) return 0;
  return round4(m / (1 + m));
}

/**
 * The markup needed to achieve a margin.
 *
 * margin 0.20 → markup 0.25. This is the direction an estimator actually wants
 * and almost never has to hand, which is why they use the other one by
 * mistake.
 */
export function marginToMarkup(margin: number): number {
  const m = Number(margin) || 0;
  // A hundred per cent margin would need an infinite markup: the selling price
  // would be all profit and no cost, which is not a thing.
  if (m >= 1) return 0;
  return round4(m / (1 - m));
}

/** What to sell at, from a cost and whichever percentage was actually meant. */
export function sellFrom(cost: number, basis: { markup?: number; margin?: number }): number {
  const c = Number(cost) || 0;
  if (basis.margin != null) {
    const m = Number(basis.margin) || 0;
    if (m >= 1) return 0;
    return round2(c / (1 - m));
  }
  return round2(c * (1 + (Number(basis.markup) || 0)));
}

/* ========================================================= the build-up == */

export type BuildUpLike = {
  /** Material cost for one unit of the bid item, wastage already in it. */
  materialCost?: number | null;
  labourHours?: number | null;
  labourRate?: number | null;
  plantHours?: number | null;
  plantRate?: number | null;
  subcontractCost?: number | null;
};

export type BuildUp = {
  material: number;
  labour: number;
  plant: number;
  subcontract: number;
  /** What one unit costs before any overhead or margin. */
  total: number;
};

/** What one unit costs, from its parts. Never typed over. */
export function buildUp(b: BuildUpLike): BuildUp {
  const material = round2(b.materialCost);
  const labour = round2((Number(b.labourHours) || 0) * (Number(b.labourRate) || 0));
  const plant = round2((Number(b.plantHours) || 0) * (Number(b.plantRate) || 0));
  const subcontract = round2(b.subcontractCost);
  return {
    material,
    labour,
    plant,
    subcontract,
    total: round2(material + labour + plant + subcontract),
  };
}

/* ============================================================= takeoff == */

export type TakeoffLike = {
  /** How much material one unit of the bid item needs, before wastage. */
  perUnit: number;
  /** As a fraction: 0.05 is five per cent. */
  wastage?: number | null;
  unitCost?: number | null;
};

export type Takeoff = {
  /** What the drawings say. */
  net: number;
  /** What has to be bought. */
  gross: number;
  wasted: number;
  cost: number;
};

/**
 * How much material to buy for a quantity of the bid item (CRM-05).
 *
 * The gross is what gets ordered and the net is what ends up in the work. Both
 * are kept because the difference is the thing worth arguing about: five per
 * cent on a cable drum is a rounding error and five per cent on structural
 * steel is a week of somebody's wages.
 */
export function takeoff(quantity: number, t: TakeoffLike): Takeoff {
  const net = round3((Number(quantity) || 0) * (Number(t.perUnit) || 0));
  const waste = Math.max(0, Number(t.wastage) || 0);
  const gross = round3(net * (1 + waste));
  return {
    net,
    gross,
    wasted: round3(gross - net),
    cost: round2(gross * (Number(t.unitCost) || 0)),
  };
}

/**
 * What one unit's material costs, from its takeoff (CRM-05).
 *
 * When a line has a takeoff, this IS its material cost — it is not typed and
 * then checked against the takeoff, because two figures that are supposed to
 * agree eventually will not, and the one on the screen will be the wrong one.
 * A line with no takeoff falls back to a figure somebody entered, which is
 * ordinary for small items nobody is going to measure.
 */
export function materialPerUnit(takeoffs: TakeoffLike[]): number {
  return round2(
    takeoffs.reduce((sum, t) => {
      const waste = Math.max(0, Number(t.wastage) || 0);
      return sum + (Number(t.perUnit) || 0) * (1 + waste) * (Number(t.unitCost) || 0);
    }, 0),
  );
}

/* ========================================================== a bid line == */

export type BidLineLike = {
  unit: string;
  quantity?: number | null;
  build: BuildUpLike;
};

export type BidLine = {
  /** 1 on a lump sum, whatever anybody typed. */
  quantity: number;
  unitCost: number;
  /** Direct cost for the whole line, before overheads and margin. */
  cost: number;
  build: BuildUp;
};

export function bidLine(line: BidLineLike): BidLine {
  const build = buildUp(line.build);
  const quantity = isLumpSum(line.unit) ? 1 : round3(line.quantity);
  return {
    quantity,
    unitCost: build.total,
    cost: round2(quantity * build.total),
    build,
  };
}

/* ========================================================= the estimate == */

export type Indirects = {
  /** Site overheads, supervision, temporary works — as a fraction of direct cost. */
  overheadPct?: number | null;
  /** Anything with a figure rather than a percentage: bonds, insurance, mobilisation. */
  fixedCosts?: number | null;
};

export type Basis =
  | { kind: "markup"; value: number }
  | { kind: "margin"; value: number };

export type EstimateTotals = {
  lines: number;
  /** Labour, material, plant and subcontract across every line. */
  direct: number;
  material: number;
  labour: number;
  plant: number;
  subcontract: number;
  /** Overheads and fixed costs. */
  indirect: number;
  /** Everything it costs to do the work. */
  cost: number;
  /** What to quote. */
  sell: number;
  profit: number;
  /** As the accounts will report it. */
  margin: number;
  /** As the estimator probably said it. */
  markup: number;
};

/**
 * What the whole estimate comes to.
 *
 * The order is the rule: direct cost, then indirects, then margin. Applying
 * the margin before the overheads is how an estimate shows twenty per cent and
 * the job returns four — the overheads come straight back out of the profit
 * and nobody sees it until the contract is finished.
 */
export function summariseEstimate(
  lines: BidLineLike[],
  indirects: Indirects = {},
  basis: Basis = { kind: "markup", value: 0 },
): EstimateTotals {
  let material = 0, labour = 0, plant = 0, subcontract = 0, direct = 0;

  for (const l of lines) {
    const priced = bidLine(l);
    material = round2(material + priced.quantity * priced.build.material);
    labour = round2(labour + priced.quantity * priced.build.labour);
    plant = round2(plant + priced.quantity * priced.build.plant);
    subcontract = round2(subcontract + priced.quantity * priced.build.subcontract);
    direct = round2(direct + priced.cost);
  }

  const overhead = round2(direct * Math.max(0, Number(indirects.overheadPct) || 0));
  const fixed = round2(indirects.fixedCosts);
  const indirect = round2(overhead + fixed);
  const cost = round2(direct + indirect);

  const sell =
    basis.kind === "margin"
      ? sellFrom(cost, { margin: basis.value })
      : sellFrom(cost, { markup: basis.value });
  const profit = round2(sell - cost);

  return {
    lines: lines.length,
    direct, material, labour, plant, subcontract,
    indirect,
    cost,
    sell,
    profit,
    // Guarded because a hundred per cent margin sells for nil, and -cost/0 is
    // -Infinity rather than NaN — which round4 would carry straight through to
    // a screen showing an infinite loss.
    margin: sell > 0 ? round4(profit / sell) : 0,
    markup: cost > 0 ? round4(profit / cost) : 0,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * What the estimate says, in a sentence.
 *
 * Both percentages, always, in the same breath. Somebody reading "18.5% margin
 * (22.7% markup)" cannot make the mistake the whole module exists to prevent.
 */
export function estimateVerdict(totals: EstimateTotals): string {
  if (!totals.lines) return "Nothing priced yet.";
  if (totals.cost <= 0) return `${totals.lines} line${totals.lines === 1 ? "" : "s"}, and nothing costed yet.`;

  const parts = [
    `Costs ${fmt(totals.cost)}, quote ${fmt(totals.sell)}.`,
    `${fmt(totals.profit)} profit — ${pct(totals.margin)} margin, which is ${pct(totals.markup)} markup.`,
  ];

  if (totals.indirect > 0) {
    parts.push(`${fmt(totals.indirect)} of that cost is overhead, added before the margin.`);
  }
  // Break-even and a loss are different news and must not read the same. At
  // exactly cost the job makes nothing, which is a decision somebody might
  // have taken; below cost it is losing money, which is usually a mistake.
  if (totals.profit < 0) {
    parts.push("At this price the job loses money.");
  } else if (totals.profit === 0) {
    parts.push("At this price the job makes nothing.");
  }
  return parts.join(" ");
}

/**
 * Whether an estimate is fit to quote from.
 *
 * Refuses the two states that produce a number somebody would act on and
 * should not: nothing costed, and a price below cost with nobody having said
 * so on purpose.
 */
export function checkQuotable(
  totals: EstimateTotals,
  acceptLoss = false,
): { ok: true } | { ok: false; error: string } {
  if (!totals.lines) return { ok: false, error: "Add at least one line before quoting from this." };
  if (totals.cost <= 0) {
    return { ok: false, error: "Nothing has been costed yet, so there is no price to quote." };
  }
  if (totals.profit < 0 && !acceptLoss) {
    return {
      ok: false,
      error:
        `This quotes ${fmt(Math.abs(totals.profit))} below what the work costs. ` +
        `Say so deliberately if it is a loss leader, or put the price up.`,
    };
  }
  return { ok: true };
}
