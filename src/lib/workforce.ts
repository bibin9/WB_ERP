/**
 * The nationality mix of a workforce, and what it would take to change it.
 *
 * MOHRE classifies an establishment, and that classification moves what every
 * work permit costs. Diversity of nationalities is one of the inputs. The exact
 * share MOHRE will accept is theirs to set and is revised from time to time, so
 * nothing here treats a percentage as the law: the company enters the figure it
 * is working to, from its PRO or typing centre, and this measures against it.
 *
 * Two counting rules matter more than the arithmetic.
 *
 * Supplied labour is excluded. Those workers are sponsored by the manpower
 * supplier and sit on the supplier's establishment, not this one; counting them
 * would produce a mix that belongs to somebody else.
 *
 * Employees with no nationality recorded are counted in the headcount and named
 * separately. Quietly dropping them from the denominator makes every share look
 * smaller than it is, which is the direction an error must never go on a report
 * somebody uses to plan hiring.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Offered as a starting point. It is a target the company sets, not a statute. */
export const DEFAULT_MAX_NATIONALITY_SHARE = 50;

export type WorkforcePerson = {
  employeeId: string;
  nationality: string | null;
  /** "Supplied" means sponsored by a manpower supplier, not by this company. */
  employmentType: string | null;
  status: string;
};

export type NationalityRow = {
  nationality: string;
  count: number;
  /** Share of the whole headcount, as a percentage. */
  share: number;
  isUnrecorded: boolean;
};

export type WorkforceMix = {
  /** Own employees only, active only. */
  headcount: number;
  rows: NationalityRow[];
  largest: NationalityRow | null;
  /** How many nationalities are actually represented (unrecorded excluded). */
  distinct: number;
  unrecorded: number;
  /**
   * The largest share if every unrecorded person turned out to be that same
   * nationality. When some are unrecorded the true figure is a range, and the
   * report says so rather than picking the flattering end.
   */
  largestWorstCase: number;
  emirati: number;
  /** Excluded from every figure above, but worth stating so nobody thinks they were forgotten. */
  suppliedExcluded: number;
};

/** Nationality words that mean an Emirati national. */
const EMIRATI = new Set(["emirati", "uae", "united arab emirates", "emirian", "emiratis"]);

export function workforceMix(people: WorkforcePerson[]): WorkforceMix {
  const own = people.filter((p) => p.status !== "Inactive" && p.employmentType !== "Supplied");
  const suppliedExcluded = people.filter((p) => p.status !== "Inactive" && p.employmentType === "Supplied").length;
  const headcount = own.length;

  const counts = new Map<string, number>();
  let unrecorded = 0;
  for (const p of own) {
    const name = (p.nationality ?? "").trim();
    if (!name) { unrecorded++; continue; }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const share = (n: number) => (headcount > 0 ? round1((n / headcount) * 100) : 0);

  const rows: NationalityRow[] = [...counts.entries()]
    .map(([nationality, count]) => ({ nationality, count, share: share(count), isUnrecorded: false }))
    .sort((a, b) => b.count - a.count || a.nationality.localeCompare(b.nationality));

  if (unrecorded > 0) {
    rows.push({ nationality: "Not recorded", count: unrecorded, share: share(unrecorded), isUnrecorded: true });
  }

  const largest = rows.find((r) => !r.isUnrecorded) ?? null;

  return {
    headcount,
    rows,
    largest,
    distinct: counts.size,
    unrecorded,
    largestWorstCase: largest ? share(largest.count + unrecorded) : 0,
    emirati: [...counts.entries()]
      .filter(([n]) => EMIRATI.has(n.trim().toLowerCase()))
      .reduce((t, [, c]) => t + c, 0),
    suppliedExcluded,
  };
}

/* ==================== what it would take to change it ==================== */

export type DiversityGap = {
  /** The target the company is working to, as a percentage. */
  target: number;
  overBy: number;
  /** People of other nationalities to hire, to come under the target. */
  hire: number;
  /** People of the largest nationality to lose, to come under the target. */
  reduce: number;
};

/**
 * How far off the target, and what closes it.
 *
 * Two ways to move a ratio and both are offered, because only one of them is
 * usually available: recruitment is a decision, and letting people go rarely
 * is. Hiring is the number a PRO plans the next quarter around; the other is
 * there because visas not renewed do the same arithmetic without anybody being
 * dismissed.
 *
 *   hiring n others:  largest / (headcount + n) <= t   →   n >= largest/t - headcount
 *   losing r of them: (largest - r) / (headcount - r) <= t
 *                     →   r >= (largest - t*headcount) / (1 - t)
 */
export function diversityGap(mix: WorkforceMix, targetPercent: number): DiversityGap | null {
  if (!mix.largest || mix.headcount === 0) return null;
  const target = targetPercent;
  if (!(target > 0) || target >= 100) return null;
  if (mix.largest.share <= target) return null;

  const t = target / 100;
  const largest = mix.largest.count;
  const hire = Math.max(0, Math.ceil(largest / t - mix.headcount));
  const reduce = Math.max(0, Math.ceil((largest - t * mix.headcount) / (1 - t)));

  return { target, overBy: round1(mix.largest.share - target), hire, reduce };
}

/** One sentence for the top of the screen. */
export function mixVerdict(
  mix: WorkforceMix,
  gap: DiversityGap | null,
  targetPercent: number,
): { tone: "good" | "watch" | "bad"; text: string } {
  if (mix.headcount === 0) {
    return { tone: "watch", text: "No active employees of your own — only supplied labour, which sits on the supplier's establishment." };
  }
  if (!mix.largest) {
    return { tone: "watch", text: "No nationality is recorded against anybody, so there is no mix to report yet." };
  }

  const who = `${mix.largest.nationality} nationals are ${mix.largest.share}% of the workforce`;

  if (gap) {
    const ways = gap.hire > 0
      ? `Hiring ${gap.hire} ${gap.hire === 1 ? "person" : "people"} of other nationalities, or ${gap.reduce} fewer ${mix.largest.nationality} ${gap.reduce === 1 ? "national" : "nationals"}, brings it under.`
      : "";
    return { tone: "bad", text: `${who}, above the ${targetPercent}% you are working to. ${ways}`.trim() };
  }

  // Within ten per cent of the target is close enough that one resignation or
  // one hire moves it, which is worth knowing before it does.
  if (targetPercent > 0 && mix.largest.share > targetPercent * 0.9) {
    return { tone: "watch", text: `${who}, just under the ${targetPercent}% you are working to. A few hires either way will cross it.` };
  }
  return { tone: "good", text: `${who}, inside the ${targetPercent}% you are working to, across ${mix.distinct} nationalities.` };
}
