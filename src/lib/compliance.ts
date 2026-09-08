/**
 * UAE labour compliance a contractor is actually measured on.
 *
 * Three rules that have nothing in common except that MOHRE fines you for each
 * of them, and that an SME finds out about all three too late:
 *
 *   - the summer midday ban, which a construction company breaks by accident
 *     and can only disprove with its own punch data;
 *   - ILOE, where the fine lands on the employee but the blocked work permit
 *     lands on the employer;
 *   - Emiratisation, where the bill arrives once a year and is the size of a
 *     salary.
 *
 * Every figure here was checked against current MOHRE guidance rather than
 * remembered. They move — the Emiratisation contribution has risen every year
 * since it was introduced — so each is a named constant with the year it
 * belongs to, and changing them is one edit rather than a search.
 *
 * Pure functions, so the compliance screen and any test arrive at the same
 * answer.
 */

/* ------------------------------------------------- the summer midday ban - */

/**
 * Outdoor work under direct sun is banned between 12:30 and 15:00, from
 * 15 June to 15 September. It is the rule a site breaks without meaning to,
 * on the first hot week, when somebody decides to push on through lunch.
 *
 * The dates are day-of-year rather than a fixed year, because the ban comes
 * round every summer.
 */
export const MIDDAY_BAN_FROM = { month: 6, day: 15 };
export const MIDDAY_BAN_TO = { month: 9, day: 15 };
export const MIDDAY_BAN_START_HOUR = 12.5;
export const MIDDAY_BAN_END_HOUR = 15;

/** Whether a date falls inside the summer ban. */
export function inMiddayBanSeason(date: Date): boolean {
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m < MIDDAY_BAN_FROM.month || m > MIDDAY_BAN_TO.month) return false;
  if (m === MIDDAY_BAN_FROM.month) return d >= MIDDAY_BAN_FROM.day;
  if (m === MIDDAY_BAN_TO.month) return d <= MIDDAY_BAN_TO.day;
  return true;
}

const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;

/**
 * Whether a day's punches suggest somebody worked through the banned window.
 *
 * This says the man was on site across the break, which is not the same as
 * saying he was outdoors in the sun — an electrician in a plant room is not in
 * breach. So it reports a day to look at, never a verdict, and the wording on
 * the screen has to keep that distinction or people learn to ignore it.
 */
export function middayBreach(date: Date, firstIn?: Date | null, lastOut?: Date | null) {
  if (!inMiddayBanSeason(date) || !firstIn || !lastOut) {
    return { inSeason: inMiddayBanSeason(date), spansBreak: false, hours: 0 };
  }
  const start = hourOf(firstIn);
  const end = hourOf(lastOut);
  // A shift that runs past midnight is not a midday question.
  if (end <= start) return { inSeason: true, spansBreak: false, hours: 0 };

  const overlap =
    Math.max(0, Math.min(end, MIDDAY_BAN_END_HOUR) - Math.max(start, MIDDAY_BAN_START_HOUR));
  return {
    inSeason: true,
    spansBreak: overlap > 0,
    hours: Math.round(overlap * 100) / 100,
  };
}

/* -------------------------------------------------------------- ILOE ----- */

/** Basic pay at or below this is Category A; above it, Category B. */
export const ILOE_CATEGORY_THRESHOLD = 16_000;
export const ILOE_CATEGORY_A_MONTHLY = 5;
export const ILOE_CATEGORY_B_MONTHLY = 10;
/** What it costs an employee not to subscribe at all. */
export const ILOE_FINE = 400;

/**
 * Which ILOE band somebody falls in, and what it costs.
 *
 * The threshold is basic pay, not the package. Crossing it does not move an
 * existing subscription on its own — the employee has to change the tier
 * themselves — so a pay rise past AED 16,000 is a thing to chase, and this
 * returns enough for the screen to say so.
 */
export function iloeCategory(basicSalary: number) {
  const basic = Number(basicSalary) || 0;
  const categoryA = basic <= ILOE_CATEGORY_THRESHOLD;
  const monthly = categoryA ? ILOE_CATEGORY_A_MONTHLY : ILOE_CATEGORY_B_MONTHLY;
  return {
    category: categoryA ? ("A" as const) : ("B" as const),
    monthly,
    annual: monthly * 12,
    note: categoryA
      ? `Basic pay is at or under AED ${ILOE_CATEGORY_THRESHOLD.toLocaleString("en-AE")}, so AED ${monthly} a month.`
      : `Basic pay is above AED ${ILOE_CATEGORY_THRESHOLD.toLocaleString("en-AE")}, so AED ${monthly} a month.`,
  };
}

export type IloeSubject = {
  name: string;
  empNo: string;
  basicSalary: number;
  employmentType: string;
  dateOfBirth?: Date | null;
  iloeSubscribed: boolean;
  iloeExempt: boolean;
  iloeExpiry?: Date | null;
};

/**
 * Who still has to subscribe, and who has let it lapse.
 *
 * The scheme leaves out investors and owners, domestic workers, temporary
 * staff, anyone under eighteen and a pensioner in a new job. Only the age and
 * the employment type are knowable from a record, so the rest is a flag
 * somebody sets — and an exempt person drops off the list rather than being
 * chased every month until the list stops being read.
 */
export function iloeStatus(e: IloeSubject, asAt: Date) {
  const under18 =
    !!e.dateOfBirth &&
    asAt.getTime() - e.dateOfBirth.getTime() < 18 * 365.25 * 86_400_000;
  const temporary = e.employmentType === "Supplied" || e.employmentType === "Part-time";

  if (e.iloeExempt || under18 || temporary) {
    return {
      required: false,
      ok: true,
      reason: e.iloeExempt
        ? "Marked exempt"
        : under18
          ? "Under eighteen — outside the scheme"
          : `${e.employmentType} — outside the scheme`,
    };
  }
  if (!e.iloeSubscribed) {
    return { required: true, ok: false, reason: `Not subscribed — a AED ${ILOE_FINE} fine, and since 2026 an unpaid liability blocks a work permit or visa transaction.` };
  }
  if (e.iloeExpiry) {
    const days = Math.floor((e.iloeExpiry.getTime() - asAt.getTime()) / 86_400_000);
    if (days < 0) return { required: true, ok: false, reason: `Lapsed ${-days} days ago`, days };
    if (days <= 60) return { required: true, ok: true, expiringSoon: true, reason: `Renews in ${days} days`, days };
  }
  return { required: true, ok: true, reason: "Subscribed" };
}

/* ----------------------------------------------------- Emiratisation ----- */

/**
 * Emiratisation, as it stands for 2026.
 *
 * Two different rules, and which one applies turns on headcount:
 *
 *   - Twenty to forty-nine employees, in one of the fourteen sectors MOHRE has
 *     named — construction among them — must employ two UAE nationals by 2026,
 *     one having been due in 2024. The shortfall was collected in January 2026
 *     as a one-off AED 108,000 per missing hire.
 *   - Fifty and above: two per cent growth a year in skilled roles, and a
 *     monthly AED 9,000 for each position left unfilled.
 *
 * Below twenty employees neither applies, which is worth stating on the screen
 * rather than showing an empty panel — a contractor at eighteen staff wants to
 * know the rule is coming, not that there is nothing to see.
 */
export const EMIRATISATION_SMALL_BAND = { from: 20, to: 49 };
export const EMIRATISATION_LARGE_FROM = 50;
/** Nationals required of a 20–49 company in a priority sector, by 2026. */
export const SMALL_BAND_REQUIRED_2026 = 2;
/** Collected once, in January 2026, per missing hire in that band. */
export const SMALL_BAND_CONTRIBUTION = 108_000;
/** Skilled-role growth a large company must add each year. */
export const LARGE_ANNUAL_TARGET = 0.02;
/** Per unfilled skilled position, per month, in 2026. */
export const LARGE_MONTHLY_CONTRIBUTION = 9_000;

/**
 * Whether a nationality reads as a UAE national.
 *
 * Nationality is free text, so this matches what people actually type. Records
 * it counts are listed on the screen beside the number, because a nationality
 * spelled some other way is invisible otherwise — and an Emiratisation count
 * that is quietly one short is the expensive kind of wrong.
 */
export function isEmirati(nationality?: string | null): boolean {
  if (!nationality) return false;
  const n = nationality.trim().toLowerCase().replace(/[.\-_]/g, " ").replace(/\s+/g, " ");
  return (
    n === "emirati" ||
    n === "emiratis" ||
    n === "uae" ||
    n === "uae national" ||
    n === "uae nationals" ||
    n === "united arab emirates" ||
    n === "emirati (uae)" ||
    n === "uae citizen"
  );
}

export type EmiratisationInput = {
  /** Everyone on the books, whatever their role. */
  headcount: number;
  /** Roles MOHRE would count as skilled. */
  skilledCount: number;
  /** UAE nationals employed. */
  nationals: number;
  /** Whether the company trades in one of the fourteen named sectors. */
  prioritySector: boolean;
};

export function emiratisation(i: EmiratisationInput) {
  const { headcount, skilledCount, nationals, prioritySector } = i;

  if (headcount < EMIRATISATION_SMALL_BAND.from) {
    return {
      applies: false,
      band: "under-20" as const,
      required: 0,
      nationals,
      shortfall: 0,
      exposure: 0,
      note: `Emiratisation starts at ${EMIRATISATION_SMALL_BAND.from} employees. This company has ${headcount}.`,
    };
  }

  if (headcount <= EMIRATISATION_SMALL_BAND.to) {
    if (!prioritySector) {
      return {
        applies: false,
        band: "20-49" as const,
        required: 0,
        nationals,
        shortfall: 0,
        exposure: 0,
        note: "Between 20 and 49 employees, the target applies only to the fourteen sectors MOHRE has named. This company is not marked as one of them — check the setting if that is wrong.",
      };
    }
    const shortfall = Math.max(0, SMALL_BAND_REQUIRED_2026 - nationals);
    return {
      applies: true,
      band: "20-49" as const,
      required: SMALL_BAND_REQUIRED_2026,
      nationals,
      shortfall,
      exposure: shortfall * SMALL_BAND_CONTRIBUTION,
      note: `${headcount} employees in a priority sector: ${SMALL_BAND_REQUIRED_2026} UAE nationals required for 2026.`,
    };
  }

  // Fifty and above: two per cent of skilled roles, rounded up — a fraction of
  // a position is still a position MOHRE expects filled.
  const required = Math.ceil(skilledCount * LARGE_ANNUAL_TARGET);
  const shortfall = Math.max(0, required - nationals);
  return {
    applies: true,
    band: "50-plus" as const,
    required,
    nationals,
    shortfall,
    /** A year of monthly contributions, which is how the bill is felt. */
    exposure: shortfall * LARGE_MONTHLY_CONTRIBUTION * 12,
    monthlyExposure: shortfall * LARGE_MONTHLY_CONTRIBUTION,
    note: `${headcount} employees, ${skilledCount} in skilled roles: ${Math.round(LARGE_ANNUAL_TARGET * 100)}% of skilled roles is ${required} UAE national${required === 1 ? "" : "s"}.`,
  };
}
