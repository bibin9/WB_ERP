/**
 * Material coming back from site (INV-16).
 *
 * A job draws more than it needs, because running short on a Friday costs more
 * than a coil of spare cable does. What comes back is either usable again or it
 * is not, and those two are different events however similar they look on the
 * back of a lorry.
 *
 * Reusable
 * --------
 * It goes back on the shelf at what it cost, and the job is credited with the
 * same. The company still owns it and can still sell the work it does; nothing
 * has been consumed.
 *
 * Scrap
 * -----
 * The job consumed it. Offcuts, damaged lengths, a spool crushed by a forklift.
 * It keeps the cost, because the cost is real and that contract caused it, and
 * nothing goes back into stock because scrap is not stock — putting it there at
 * full value would inflate the shelf with material nobody can use, and putting
 * it there at nil value would dilute the average of everything beside it.
 *
 * So a scrap line records what happened and posts nothing. The material is
 * logged, the job keeps its cost, and the stock ledger is left alone.
 *
 * Getting this backwards is how a job that wasted six drums of cable reports
 * the same margin as one that wasted none.
 *
 * Not server-only: the form totals and warns before anything is saved.
 */

export const RETURN_CONDITIONS = ["Reusable", "Scrap"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const CONDITION_HELP: Record<string, string> = {
  Reusable:
    "Still good. It goes back on the shelf at what it cost, and the job is credited with the same amount.",
  Scrap:
    "Used up, damaged or offcut. The job keeps the cost, because it caused it, and nothing goes back into stock.",
};

export const RETURN_STATUSES = ["Draft", "Posted", "Cancelled"] as const;

export const RETURN_STATUS_HELP: Record<string, string> = {
  Draft: "Written but not yet acted on. Nothing has moved and no job has been credited.",
  Posted: "Acted on. Reusable material is back on the shelf and the job has been credited for it.",
  Cancelled: "Called off before it was posted.",
};

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type ReturnLineLike = {
  condition: string;
  quantity: number;
  /** What the return was worth. Nil on scrap, by definition. */
  value?: number | null;
};

/** Whether a line puts material back on the shelf. */
export const goesBackToStock = (condition: string): boolean => condition === "Reusable";

export type ReturnTotals = {
  lines: number;
  reusableLines: number;
  scrapLines: number;
  reusableQuantity: number;
  scrapQuantity: number;
  /** Credited back to the job. Scrap contributes nothing. */
  creditedToJob: number;
};

export function summariseReturn(lines: ReturnLineLike[]): ReturnTotals {
  const t: ReturnTotals = {
    lines: lines.length,
    reusableLines: 0,
    scrapLines: 0,
    reusableQuantity: 0,
    scrapQuantity: 0,
    creditedToJob: 0,
  };
  for (const l of lines) {
    const q = Number(l.quantity) || 0;
    if (goesBackToStock(l.condition)) {
      t.reusableLines += 1;
      t.reusableQuantity += q;
      t.creditedToJob += Number(l.value) || 0;
    } else {
      t.scrapLines += 1;
      t.scrapQuantity += q;
    }
  }
  t.reusableQuantity = round3(t.reusableQuantity);
  t.scrapQuantity = round3(t.scrapQuantity);
  t.creditedToJob = round2(t.creditedToJob);
  return t;
}

/**
 * Whether a line can be returned at all.
 *
 * Returning more than the job was ever issued is refused. It is not pedantry:
 * an unchecked return credits a job with material it never had, and the margin
 * on that contract quietly improves for no reason anybody can later find.
 */
export function checkReturn(
  quantity: number,
  issuedToJob: number,
  alreadyReturned: number,
  itemName = "this item",
): { ok: true } | { ok: false; error: string } {
  const q = round3(quantity);
  if (q <= 0) return { ok: false, error: "Enter how much is coming back." };

  const outstanding = round3(Math.max(0, issuedToJob - alreadyReturned));
  if (issuedToJob <= 0) {
    return {
      ok: false,
      error: `No ${itemName} was ever issued to this job, so there is nothing to bring back. Record it as an adjustment if it turned up another way.`,
    };
  }
  if (outstanding <= 0) {
    return { ok: false, error: `All the ${itemName} issued to this job has already been returned.` };
  }
  if (q > outstanding) {
    return {
      ok: false,
      error:
        `Only ${outstanding.toLocaleString()} of ${itemName} is still out on this job. ` +
        `Returning more would credit it with material it never had.`,
    };
  }
  return { ok: true };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What this return will do, in a sentence, before it is posted.
 *
 * The scrap half is stated explicitly because it is the half people expect to
 * behave like the other one. Somebody returning six drums of ruined cable
 * reasonably assumes the job gets something back; it does not, and finding that
 * out afterwards from a margin report is worse than reading it here.
 */
export function returnVerdict(lines: ReturnLineLike[]): string {
  if (!lines.length) return "Nothing on this note yet.";

  const t = summariseReturn(lines);
  const parts: string[] = [];

  if (t.reusableLines > 0) {
    parts.push(
      `${plural(t.reusableLines, "line")} going back on the shelf, crediting the job ${fmt(t.creditedToJob)}.`,
    );
  }
  if (t.scrapLines > 0) {
    parts.push(
      `${plural(t.scrapLines, "line is", "lines are")} scrap: the job keeps that cost and nothing returns to stock.`,
    );
  }
  return parts.join(" ");
}
