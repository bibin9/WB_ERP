/**
 * One company's HR policy.
 *
 * Federal Decree-Law 33/2021 sets a floor, not a rule. Thirty days of annual
 * leave is the least an employer may give; plenty of UAE companies give more,
 * pay overtime above the statutory 125%, or write a sixty-day notice period
 * into a senior contract. Until now every one of those numbers was a constant
 * in the code, which is fine for one company and wrong for a product — WBE,
 * WBTS and VTS do not have to run the same handbook, and the next customer
 * certainly will not.
 *
 * So the numbers move to a policy record, one per company, and the code reads
 * them. What does not move is the floor: a policy that gives less than the law
 * is refused, with the article that refuses it. An ERP that lets somebody
 * configure a twenty-day leave entitlement has not given them flexibility, it
 * has helped them into a labour claim.
 *
 * Two kinds of number live here and they behave differently:
 *
 *   - a MINIMUM the employer may exceed — leave days, overtime rates, gratuity
 *     days, sick pay;
 *   - a MAXIMUM the employer may not exceed — probation length, notice period,
 *     which the law caps in the employee's favour.
 *
 * Pure: no server-only import, so a settings form can validate as it is typed
 * and the server can validate the same way when it saves.
 */

export type HrPolicy = {
  /* -------------------------------------------------------- annual leave - */
  /** Days a year once a full year of service is complete. At least 30. */
  annualLeaveDays: number;
  /** Months of service before anything accrues. At most 6 — the law gives an
   *  entitlement from six months and an employer may start it sooner. */
  leaveAccrualAfterMonths: number;
  /** Days accrued for each month between that point and the first year. */
  partYearDaysPerMonth: number;
  /** How much may be carried past a service anniversary. Pure policy — the law
   *  expects leave to be taken in the year it is earned and says nothing about
   *  hoarding it. */
  carryForwardDays: number;

  /* ------------------------------------------------- probation and notice - */
  /** Default probation length in months. Six is the statutory ceiling. */
  probationMonths: number;
  /** Notice the employer gives during probation. Fourteen days is the floor. */
  probationNoticeDays: number;
  /** Default notice period outside probation. Between 30 and 90 days. */
  noticeDays: number;

  /* --------------------------------------------------------- working time - */
  /** A normal working day. Eight hours is the statutory maximum. */
  normalHoursPerDay: number;
  /** The divisor for a daily wage. Thirty is what MOHRE uses; some contracts
   *  say twenty-six. It is the employee's interest that it be small. */
  daysPerMonth: number;
  /** Ordinary overtime, as a multiple of basic. At least 1.25. */
  otNormalRate: number;
  /** Night, rest-day and holiday overtime. At least 1.5. */
  otPremiumRate: number;

  /* ------------------------------------------------------------ sick pay - */
  /** Days at full pay, then at half, then unpaid. 15 / 30 / 45 by law. */
  sickFullDays: number;
  sickHalfDays: number;
  sickUnpaidDays: number;
  /** What the middle band pays. Half by law; some handbooks pay more. */
  sickHalfPayRate: number;

  /* ------------------------------------------------------------ gratuity - */
  /** Days of basic per year, for the first five years and after. 21 / 30. */
  gratuityFirst5Days: number;
  gratuityAfter5Days: number;
  /** The cap, in years of basic pay. Two by law. */
  gratuityCapYears: number;
  /** Service needed before any gratuity is earned. One year by law; an
   *  employer may promise it sooner. */
  gratuityMinYears: number;

  /* ---------------------------------------------------------- air ticket - */
  /** How often the contract gives a repatriation ticket, in months. Not a
   *  statutory entitlement at all — it is whatever the contract says. */
  airTicketEveryMonths: number;
  /** What to assume when an employee's own record does not say. */
  airTicketDefault: number;
};

/**
 * The statutory position, and the default a new company starts from.
 *
 * Every figure here is the law's own. A company that never opens the settings
 * screen is compliant, which is the right way round for a default.
 */
export const STATUTORY_POLICY: HrPolicy = {
  annualLeaveDays: 30,
  leaveAccrualAfterMonths: 6,
  partYearDaysPerMonth: 2,
  carryForwardDays: 30,

  probationMonths: 6,
  probationNoticeDays: 14,
  noticeDays: 30,

  normalHoursPerDay: 8,
  daysPerMonth: 30,
  otNormalRate: 1.25,
  otPremiumRate: 1.5,

  sickFullDays: 15,
  sickHalfDays: 30,
  sickUnpaidDays: 45,
  sickHalfPayRate: 0.5,

  gratuityFirst5Days: 21,
  gratuityAfter5Days: 30,
  gratuityCapYears: 2,
  gratuityMinYears: 1,

  airTicketEveryMonths: 24,
  airTicketDefault: 0,
};


type Rule = {
  key: keyof HrPolicy;
  label: string;
  /** "min" — the policy may not go below the law. "max" — may not go above. */
  bound: "min" | "max";
  limit: number;
  /** The reason, in the words a person would use to argue it. */
  why: string;
  /** A sane outer edge, to catch a typo rather than a policy. */
  sanity?: number;
};

/**
 * What the law will not let a policy do.
 *
 * Each carries its reason rather than just a number, because the person hitting
 * the limit is an HR manager who wants to know whether it is the law or the
 * software saying no.
 */
export const POLICY_RULES: Rule[] = [
  { key: "annualLeaveDays", label: "Annual leave", bound: "min", limit: 30, sanity: 90,
    why: "Article 29 gives 30 days a year. You may give more, never less." },
  { key: "leaveAccrualAfterMonths", label: "Leave starts accruing after", bound: "max", limit: 6,
    why: "The entitlement exists from six months of service. Starting later would withhold it." },
  { key: "partYearDaysPerMonth", label: "Accrual before the first year", bound: "min", limit: 2, sanity: 5,
    why: "Two days a month between six months and a year, at least." },
  { key: "carryForwardDays", label: "Carry-forward ceiling", bound: "min", limit: 0, sanity: 120,
    why: "Company policy. The law expects leave to be taken in the year it is earned." },

  { key: "probationMonths", label: "Probation", bound: "max", limit: 6,
    why: "Article 9 caps probation at six months and it cannot be extended." },
  { key: "probationNoticeDays", label: "Notice during probation", bound: "min", limit: 14, sanity: 90,
    why: "Fourteen days is the least an employer may give during probation." },
  { key: "noticeDays", label: "Notice period", bound: "min", limit: 30,
    why: "Notice runs from 30 to 90 days. Less than 30 is not enforceable." },

  { key: "normalHoursPerDay", label: "Normal working day", bound: "max", limit: 8,
    why: "Article 17: eight hours a day, forty-eight a week. A longer day is overtime." },
  { key: "daysPerMonth", label: "Daily-wage divisor", bound: "max", limit: 30, sanity: 20,
    why: "A larger divisor makes every day of pay smaller. Thirty is what MOHRE uses." },
  { key: "otNormalRate", label: "Overtime rate", bound: "min", limit: 1.25, sanity: 3,
    why: "Article 19: ordinary overtime is 125% of basic, at least." },
  { key: "otPremiumRate", label: "Night / rest-day overtime", bound: "min", limit: 1.5, sanity: 3,
    why: "150% between 22:00 and 04:00, on a rest day, or on a public holiday." },

  { key: "sickFullDays", label: "Sick leave at full pay", bound: "min", limit: 15, sanity: 90,
    why: "Article 31: the first fifteen days at full pay." },
  { key: "sickHalfDays", label: "Sick leave at half pay", bound: "min", limit: 30, sanity: 120,
    why: "The next thirty days at half pay, at least." },
  { key: "sickUnpaidDays", label: "Sick leave unpaid", bound: "min", limit: 0, sanity: 120,
    why: "The last band of the ninety-day entitlement." },
  { key: "sickHalfPayRate", label: "Half-pay rate", bound: "min", limit: 0.5, sanity: 1,
    why: "The middle band pays at least half. Paying more is allowed." },

  { key: "gratuityFirst5Days", label: "Gratuity, first five years", bound: "min", limit: 21, sanity: 60,
    why: "Twenty-one days of basic per year for the first five years, at least." },
  { key: "gratuityAfter5Days", label: "Gratuity, after five years", bound: "min", limit: 30, sanity: 60,
    why: "Thirty days of basic per year beyond the fifth." },
  { key: "gratuityCapYears", label: "Gratuity cap", bound: "min", limit: 2, sanity: 10,
    why: "Total gratuity is capped at two years' basic pay. A lower cap would withhold it." },
  { key: "gratuityMinYears", label: "Service before gratuity", bound: "max", limit: 1,
    why: "One completed year earns it. Requiring longer would withhold a statutory entitlement." },

  { key: "airTicketEveryMonths", label: "Air ticket every", bound: "min", limit: 0, sanity: 60,
    why: "Not a statutory entitlement — whatever the contract says." },
  { key: "airTicketDefault", label: "Air ticket allowance", bound: "min", limit: 0, sanity: 50_000,
    why: "Not a statutory entitlement — whatever the contract says." },
];

export type PolicyProblem = { key: keyof HrPolicy; label: string; message: string };

/**
 * Check a policy against the law.
 *
 * Returns everything wrong at once rather than the first thing, because
 * somebody setting up a company is filling in twenty boxes and being sent back
 * twenty times is how a settings screen gets abandoned half-finished.
 */
export function validatePolicy(p: Partial<HrPolicy>): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  for (const r of POLICY_RULES) {
    const v = Number(p[r.key]);
    if (!Number.isFinite(v)) {
      problems.push({ key: r.key, label: r.label, message: `${r.label} needs a number.` });
      continue;
    }
    if (v < 0) {
      problems.push({ key: r.key, label: r.label, message: `${r.label} cannot be negative.` });
      continue;
    }
    if (r.bound === "min" && v < r.limit) {
      problems.push({ key: r.key, label: r.label, message: `${r.label} cannot be below ${r.limit}. ${r.why}` });
    }
    if (r.bound === "max" && v > r.limit) {
      problems.push({ key: r.key, label: r.label, message: `${r.label} cannot be above ${r.limit}. ${r.why}` });
    }
    if (r.sanity !== undefined) {
      const wild = r.bound === "min" ? v > r.sanity : v < r.sanity;
      if (wild) {
        problems.push({
          key: r.key,
          label: r.label,
          message: `${r.label} of ${v} looks like a typing slip rather than a policy. Check it.`,
        });
      }
    }
  }

  // Sick leave is three bands of one entitlement, so the bands have to add up
  // to something a person would recognise as a year's cover.
  const total =
    (Number(p.sickFullDays) || 0) + (Number(p.sickHalfDays) || 0) + (Number(p.sickUnpaidDays) || 0);
  if (total < 90) {
    problems.push({
      key: "sickUnpaidDays",
      label: "Sick leave",
      message: `The three sick-leave bands come to ${total} days. Article 31 gives ninety days a year in total.`,
    });
  }

  return problems;
}

/** Fill any gap from the statutory position, so a partial record is usable. */
export function withDefaults(p?: Partial<HrPolicy> | null): HrPolicy {
  if (!p) return { ...STATUTORY_POLICY };
  const out = { ...STATUTORY_POLICY };
  for (const k of Object.keys(STATUTORY_POLICY) as (keyof HrPolicy)[]) {
    const v = Number(p[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Days accrued for each month of a completed year, derived rather than stored. */
export const fullYearDaysPerMonth = (p: HrPolicy): number => p.annualLeaveDays / 12;

/** Where a policy is more generous than the law, so the screen can say so. */
export function aboveStatutory(p: HrPolicy): string[] {
  const better: string[] = [];
  if (p.annualLeaveDays > STATUTORY_POLICY.annualLeaveDays)
    better.push(`${p.annualLeaveDays} days of annual leave, against the statutory 30`);
  if (p.otNormalRate > STATUTORY_POLICY.otNormalRate)
    better.push(`overtime at ${Math.round(p.otNormalRate * 100)}%, against 125%`);
  if (p.otPremiumRate > STATUTORY_POLICY.otPremiumRate)
    better.push(`night and rest-day overtime at ${Math.round(p.otPremiumRate * 100)}%, against 150%`);
  if (p.sickHalfPayRate > STATUTORY_POLICY.sickHalfPayRate)
    better.push(`sick leave's middle band at ${Math.round(p.sickHalfPayRate * 100)}%, against 50%`);
  if (p.gratuityFirst5Days > STATUTORY_POLICY.gratuityFirst5Days)
    better.push(`${p.gratuityFirst5Days} days of gratuity a year for the first five, against 21`);
  if (p.probationMonths < STATUTORY_POLICY.probationMonths)
    better.push(`a ${p.probationMonths}-month probation, against the six the law allows`);
  if (p.daysPerMonth < STATUTORY_POLICY.daysPerMonth)
    better.push(`a daily wage of basic ÷ ${p.daysPerMonth}, which pays more per day than ÷ 30`);
  return better;
}
