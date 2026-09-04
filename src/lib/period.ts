/**
 * Reporting periods.
 *
 * Every finance screen answers "for which dates?", so the from/to pair is
 * resolved in one place: the URL wins, otherwise the company's current
 * financial year. Dates are handled at day boundaries — `to` is inclusive, so
 * "31 Dec" includes everything posted that day.
 */

export type Period = {
  from: Date;
  to: Date;
  /** ISO yyyy-mm-dd, for form inputs and links. */
  fromStr: string;
  toStr: string;
  label: string;
  /** True when the range is the company's full current financial year. */
  isCurrentFy: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Midnight at the start of the given day, in UTC. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The last instant of the given day, so `lte` includes everything on it. */
export function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** The financial year containing `on`, for a year starting in `fyStartMonth` (1-12). */
export function financialYear(fyStartMonth: number, on = new Date()): { from: Date; to: Date } {
  const m = Math.min(12, Math.max(1, fyStartMonth || 1)) - 1;
  const y = on.getUTCMonth() >= m ? on.getUTCFullYear() : on.getUTCFullYear() - 1;
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y + 1, m, 1) - 1); // last instant of the day before
  return { from, to };
}

function parse(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const human = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/**
 * Resolve the period for a screen. `from`/`to` come from the query string;
 * anything missing or malformed falls back to the current financial year, so a
 * hand-edited URL can never produce an empty or reversed range.
 */
export function resolvePeriod(
  sp: { from?: string; to?: string },
  fyStartMonth = 1,
  now = new Date()
): Period {
  const fy = financialYear(fyStartMonth, now);
  let from = parse(sp.from) ?? fy.from;
  let to = parse(sp.to) ?? fy.to;
  if (to < from) [from, to] = [to, from]; // tolerate a reversed range

  const start = startOfDay(from);
  const end = endOfDay(to);
  const isCurrentFy = start.getTime() === fy.from.getTime() && iso(end) === iso(fy.to);

  return {
    from: start,
    to: end,
    fromStr: iso(start),
    toStr: iso(end),
    label: isCurrentFy ? `Financial year ${human(fy.from)} – ${human(fy.to)}` : `${human(start)} – ${human(end)}`,
    isCurrentFy,
  };
}

/** Quarters of a financial year, for the VAT return. */
export function quarters(fyStartMonth: number, on = new Date()): { label: string; from: string; to: string }[] {
  const fy = financialYear(fyStartMonth, on);
  const out: { label: string; from: string; to: string }[] = [];
  for (let q = 0; q < 4; q++) {
    const from = new Date(Date.UTC(fy.from.getUTCFullYear(), fy.from.getUTCMonth() + q * 3, 1));
    const to = new Date(Date.UTC(fy.from.getUTCFullYear(), fy.from.getUTCMonth() + (q + 1) * 3, 1) - 1);
    out.push({ label: `Q${q + 1} (${MONTHS[from.getUTCMonth()]}–${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()})`, from: iso(from), to: iso(to) });
  }
  return out;
}
