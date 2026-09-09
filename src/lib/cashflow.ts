/**
 * The cash flow forecast.
 *
 * Every other finance report in this system looks backwards. This one answers
 * the question a contractor actually loses sleep over: "will there be enough in
 * the bank on the 28th to pay the men?" The ingredients were all already being
 * captured — post-dated cheques with their dates, receivables with credit
 * terms, retention with release dates, payroll on a fixed day — and nothing was
 * putting them on one timeline.
 *
 * The arithmetic lives here, apart from the database, because it is the part
 * that must be right and the part worth testing directly.
 */

const DAY = 24 * 60 * 60 * 1000;
const round = (n: number) => Math.round(n * 100) / 100;

/** A quarter ahead. Far enough to see the next two paydays and a retention release. */
export const DEFAULT_WEEKS = 13;
export const MIN_WEEKS = 2;
export const MAX_WEEKS = 52;

/** Fallback payday when a company has not said which day it pays. */
export const DEFAULT_PAY_DAY = 28;

/**
 * How much to trust a line.
 *
 *   certain    a dated instrument — a cheque written or held.
 *   likely     a contractual date somebody still has to honour.
 *   estimated  a date we inferred, or a sum we averaged.
 *
 * This is not decoration. The cautious view drops estimated money COMING IN and
 * keeps estimated money GOING OUT, because prudence means doubting what you are
 * owed while still expecting to pay what you owe. Treating the two
 * symmetrically would produce a comforting number and a bounced cheque.
 */
export type Certainty = "certain" | "likely" | "estimated";

export type CashEventKind =
  | "cheque-in" | "cheque-out"
  | "receivable" | "payable"
  | "retention-in" | "retention-out"
  | "payroll";

export type CashEvent = {
  date: Date;
  /** Positive is money in, negative is money out. */
  amount: number;
  kind: CashEventKind;
  label: string;
  party?: string;
  certainty: Certainty;
  /** True when the date has already passed and it has not happened. */
  overdue?: boolean;
};

export type Bucket = {
  from: Date;
  to: Date;
  label: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  /** Balance at the end of this week. */
  closing: number;
  events: CashEvent[];
};

export type Forecast = {
  opening: number;
  buckets: Bucket[];
  closing: number;
  totalIn: number;
  totalOut: number;
  /** The worst point in the whole horizon, which is the number that matters. */
  lowest: { closing: number; bucket: Bucket | null };
  /** The first week the balance goes below zero, if it ever does. */
  shortfall: Bucket | null;
  /** Money with a date beyond the horizon — counted, not shown in a week. */
  beyondHorizon: { moneyIn: number; moneyOut: number };
  /** Inflows left out because the cautious view is on. */
  excluded: { count: number; amount: number };
};

/** Midnight UTC on the day of `d`, so a time of day cannot move a bucket. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Consecutive weeks starting on `from`.
 *
 * Weeks rather than months because payroll, cheques and a subcontractor's
 * invoice all land inside a month, and a monthly column can show a comfortable
 * net while the balance went through the floor on the 12th.
 */
export function weekBuckets(from: Date, weeks: number): { from: Date; to: Date; label: string }[] {
  const start = startOfDay(from);
  const out: { from: Date; to: Date; label: string }[] = [];
  for (let i = 0; i < weeks; i++) {
    const f = new Date(start.getTime() + i * 7 * DAY);
    const t = new Date(f.getTime() + 6 * DAY);
    out.push({ from: f, to: t, label: i === 0 ? "This week" : i === 1 ? "Next week" : `Week ${i + 1}` });
  }
  return out;
}

/**
 * Payday for each month the horizon touches.
 *
 * A month shorter than the chosen day pays on its last day — 31 in February is
 * the 28th, or the 29th in a leap year. Nobody is paid on the 31st of February,
 * and silently skipping the month would leave the largest outflow of the month
 * out of the forecast.
 */
export function payrollDates(from: Date, to: Date, dayOfMonth: number): Date[] {
  const day = Math.min(31, Math.max(1, Math.floor(dayOfMonth) || DEFAULT_PAY_DAY));
  const out: Date[] = [];
  const start = startOfDay(from);
  const end = startOfDay(to);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m, Math.min(day, lastDay)));
    if (d.getTime() >= start.getTime() && d.getTime() <= end.getTime()) out.push(d);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export type ForecastInput = {
  /** Cash and bank balance right now. */
  opening: number;
  events: CashEvent[];
  from: Date;
  weeks?: number;
  /**
   * Drop inflows we are not sure of. Outflows are never dropped — see the note
   * on Certainty above.
   */
  cautious?: boolean;
};

export function buildForecast(input: ForecastInput): Forecast {
  const weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.floor(input.weeks ?? DEFAULT_WEEKS)));
  const spec = weekBuckets(input.from, weeks);
  const horizonEnd = spec[spec.length - 1].to;
  const firstStart = spec[0].from;

  const buckets: Bucket[] = spec.map((s) => ({
    ...s, moneyIn: 0, moneyOut: 0, net: 0, closing: 0, events: [],
  }));

  let excludedCount = 0;
  let excludedAmount = 0;
  const beyond = { moneyIn: 0, moneyOut: 0 };

  for (const e of input.events) {
    if (e.amount === 0) continue;

    // Prudence is asymmetric on purpose: doubt what you are owed, expect to pay
    // what you owe.
    if (input.cautious && e.certainty === "estimated" && e.amount > 0) {
      excludedCount++;
      excludedAmount = round(excludedAmount + e.amount);
      continue;
    }

    const when = startOfDay(e.date);

    if (when.getTime() > horizonEnd.getTime()) {
      if (e.amount > 0) beyond.moneyIn = round(beyond.moneyIn + e.amount);
      else beyond.moneyOut = round(beyond.moneyOut - e.amount);
      continue;
    }

    // Anything already past its date is money that should have moved and has
    // not. It belongs in the first week, not silently dropped off the front.
    const index =
      when.getTime() < firstStart.getTime()
        ? 0
        : Math.min(buckets.length - 1, Math.floor((when.getTime() - firstStart.getTime()) / (7 * DAY)));

    const b = buckets[index];
    b.events.push(e);
    if (e.amount > 0) b.moneyIn = round(b.moneyIn + e.amount);
    else b.moneyOut = round(b.moneyOut - e.amount);
  }

  let running = round(input.opening);
  let totalIn = 0;
  let totalOut = 0;
  let lowest: { closing: number; bucket: Bucket | null } = { closing: running, bucket: null };
  let shortfall: Bucket | null = null;

  for (const b of buckets) {
    b.net = round(b.moneyIn - b.moneyOut);
    running = round(running + b.net);
    b.closing = running;
    totalIn = round(totalIn + b.moneyIn);
    totalOut = round(totalOut + b.moneyOut);
    b.events.sort((x, y) => x.date.getTime() - y.date.getTime());
    if (running < lowest.closing) lowest = { closing: running, bucket: b };
    if (shortfall === null && running < 0) shortfall = b;
  }

  return {
    opening: round(input.opening),
    buckets,
    closing: running,
    totalIn,
    totalOut,
    lowest,
    shortfall,
    beyondHorizon: beyond,
    excluded: { count: excludedCount, amount: excludedAmount },
  };
}

/**
 * One sentence saying what the forecast means, for the top of the screen.
 *
 * A table of thirteen weeks does not answer "are we all right?" on its own, and
 * the person who most needs the answer is the least likely to read the table.
 */
export function verdict(f: Forecast, currency = "AED"): { tone: "good" | "watch" | "bad"; text: string } {
  const money = (n: number) =>
    `${currency} ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (f.shortfall) {
    return {
      tone: "bad",
      text: `On present plans the bank goes overdrawn in ${f.shortfall.label.toLowerCase()} — short by ${money(f.shortfall.closing)}. Chase what you are owed, or move a payment.`,
    };
  }
  const low = f.lowest.bucket;
  if (low && f.opening > 0 && f.lowest.closing < f.opening * 0.2) {
    return {
      tone: "watch",
      text: `Cash stays positive but gets tight — down to ${money(f.lowest.closing)} in ${low.label.toLowerCase()}.`,
    };
  }
  return {
    tone: "good",
    text: `Cash stays positive across the period, with ${money(f.lowest.closing)} at the lowest point.`,
  };
}
