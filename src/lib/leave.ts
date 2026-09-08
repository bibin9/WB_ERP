/**
 * UAE annual leave.
 *
 * Article 29 of Federal Decree-Law 33/2021: thirty calendar days a year once a
 * year of service is complete, and two days for each month of service for
 * somebody who has passed six months but not yet a year. Below six months there
 * is no statutory entitlement at all.
 *
 * Why this is computed rather than stored
 * ---------------------------------------
 * The balance used to be a number sitting on the employee record, set to thirty
 * when the record was created and decremented when leave was approved. Three
 * things were wrong with that, and all three cost money in the same direction:
 *
 *   - a man two months into the job showed thirty days available, which he had
 *     not earned and could not lawfully take;
 *   - nothing ever accrued, so a man who took none in three years still showed
 *     thirty rather than the ninety he had built up;
 *   - and that figure is what the final settlement encashes, so both errors
 *     were paid out in cash on the way out of the door.
 *
 * A balance derived from the join date and the approved leave cannot drift from
 * either. The only stored number is an opening adjustment, for a company
 * bringing balances across from whatever it used before.
 *
 * Pure functions, so the leave screen, the settlement preview and the server
 * action all arrive at the same figure.
 */

import { type HrPolicy, STATUTORY_POLICY, withDefaults, fullYearDaysPerMonth } from "./hrpolicy";

/**
 * The statutory figures, kept as named constants because they are what a
 * company gets when it has set no policy of its own — and because a reader
 * needs to see what the law says next to what the handbook says.
 */
/** Days a year, once a full year of service is behind you. */
export const ANNUAL_LEAVE_DAYS = 30;

/** Nothing accrues before this many months of service. */
export const ACCRUAL_STARTS_AFTER_MONTHS = 6;

/** Months 6 to 12 accrue at this rate; a full year and beyond at 30/12. */
export const PART_YEAR_DAYS_PER_MONTH = 2;
export const FULL_YEAR_DAYS_PER_MONTH = ANNUAL_LEAVE_DAYS / 12;

/**
 * The most that may be carried past a service anniversary, on top of the year's
 * own thirty.
 *
 * Not a statutory figure — the law expects leave to be taken in the year it is
 * earned and is silent on hoarding, so this is a company policy with a default
 * that matches what most UAE SMEs actually write into a handbook. It matters
 * because without a ceiling a long-serving man accumulates a balance that turns
 * into a five-figure encashment nobody budgeted for.
 */
export const DEFAULT_CARRY_FORWARD_DAYS = 30;

const round1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const DAY_MS = 86_400_000;

/** Whole months of service completed between two dates. */
export function monthsOfService(join: Date, asAt: Date): number {
  if (!join || asAt < join) return 0;
  let months =
    (asAt.getUTCFullYear() - join.getUTCFullYear()) * 12 +
    (asAt.getUTCMonth() - join.getUTCMonth());
  // The month is not complete until the day of the month comes round again.
  if (asAt.getUTCDate() < join.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Days of annual leave earned since joining.
 *
 * Below six months: nothing. Six to twelve: two a month, and only for the
 * months actually completed. Past a year: two and a half a month, counted from
 * the join date rather than from the anniversary — otherwise the first year's
 * accrual would be thrown away on the day it finally became worth thirty.
 */
export function accruedDays(
  join: Date | null | undefined,
  asAt: Date,
  policy?: Partial<HrPolicy> | null
): number {
  if (!join) return 0;
  const p = withDefaults(policy);
  const months = monthsOfService(join, asAt);
  if (months < p.leaveAccrualAfterMonths) return 0;
  if (months < 12) return round1(months * p.partYearDaysPerMonth);
  return round1(months * fullYearDaysPerMonth(p));
}

export type LeaveBalance = {
  /** Whole months on the books. */
  months: number;
  /** Everything earned since joining, before anything was taken. */
  accrued: number;
  /** A figure carried in from whatever the company used before this system. */
  opening: number;
  /** Approved annual leave already taken. */
  taken: number;
  /** What the man can actually book today. */
  balance: number;
  /** The ceiling that balance is held at. */
  cap: number;
  /** Days lost to the carry-forward ceiling, shown rather than hidden. */
  lapsed: number;
  /** Below six months there is no entitlement yet, and the screen says so. */
  accruing: boolean;
  note: string;
};

/**
 * The balance as it stands today.
 *
 * Capped, because a balance with no ceiling becomes a liability nobody
 * budgeted for — but the days lost to the ceiling are reported rather than
 * quietly dropped, so an employee asking "where did my leave go?" gets an
 * answer instead of an argument.
 */
export function leaveBalance(
  join: Date | null | undefined,
  asAt: Date,
  takenDays: number,
  openingDays = 0,
  policy?: Partial<HrPolicy> | null
): LeaveBalance {
  const p = withDefaults(policy);
  const months = join ? monthsOfService(join, asAt) : 0;
  const accrued = accruedDays(join, asAt, p);
  const opening = round1(openingDays);
  const taken = round1(Math.max(0, takenDays));

  const raw = round1(accrued + opening - taken);
  const cap = p.annualLeaveDays + Math.max(0, p.carryForwardDays);
  const balance = round1(Math.min(raw, cap));
  const lapsed = round1(Math.max(0, raw - cap));

  const accruing = !!join && months < p.leaveAccrualAfterMonths;
  const note = !join
    ? "No join date on the record, so nothing can be worked out."
    : accruing
      ? `${months} month${months === 1 ? "" : "s"} of service — annual leave starts accruing at ${p.leaveAccrualAfterMonths} months.`
      : months < 12
        ? `${months} months of service, accruing ${p.partYearDaysPerMonth} days a month until the first year is complete.`
        : lapsed > 0
          ? `${lapsed} day${lapsed === 1 ? "" : "s"} above the carry-forward ceiling of ${cap} and no longer available.`
          : `${p.annualLeaveDays} days a year, accrued from ${join.toISOString().slice(0, 10)}.`;

  return { months, accrued, opening, taken, balance, cap, lapsed, accruing, note };
}

/**
 * Whether a request can be booked, and why not when it cannot.
 *
 * Only annual leave draws on a balance. Sick leave has its own entitlement and
 * its own pay ladder, unpaid leave is unpaid by definition, and time off in
 * lieu was earned by working for it.
 */
export function canBook(type: string, days: number, bal: LeaveBalance, policy?: Partial<HrPolicy> | null) {
  if (type !== "Annual") return { ok: true as const, note: "" };
  const p = withDefaults(policy);
  if (bal.accruing) {
    return {
      ok: false as const,
      note: `Annual leave does not accrue until ${p.leaveAccrualAfterMonths} months of service. ${bal.months} months so far.`,
    };
  }
  if (days > bal.balance) {
    return {
      ok: false as const,
      note: `Only ${bal.balance} day${bal.balance === 1 ? "" : "s"} accrued so far — this request is for ${days}.`,
    };
  }
  return { ok: true as const, note: "" };
}

/* --------------------------------------------------------------- probation */

/**
 * Probation, Article 9: six months at the very most, and it cannot be extended.
 * During it the employer gives fourteen days' notice; an employee leaving for
 * another UAE job gives a month, and one leaving the country fourteen days.
 */
export const MAX_PROBATION_MONTHS = 6;
export const PROBATION_NOTICE_DAYS = 14;

/** Notice outside probation: between thirty and ninety days, thirty by default. */
export const MIN_NOTICE_DAYS = 30;
export const MAX_NOTICE_DAYS = 90;
export const DEFAULT_NOTICE_DAYS = 30;

/**
 * Where somebody stands against their probation date.
 *
 * The date matters twice and both are easy to miss: a decision has to be taken
 * before it passes, and once it has passed the notice period changes from
 * fourteen days to whatever the contract says.
 */
export function probationState(probationEnd: Date | null | undefined, asAt: Date) {
  if (!probationEnd) return { onProbation: false, days: 0, endingSoon: false, overdue: false };
  const days = Math.floor((probationEnd.getTime() - asAt.getTime()) / DAY_MS);
  return {
    onProbation: days >= 0,
    daysRemaining: days,
    days,
    /** Close enough that a confirm-or-release decision is now due. */
    endingSoon: days >= 0 && days <= 30,
    /** Passed without anybody recording a decision. */
    overdue: days < 0,
  };
}

/**
 * The probation end a company's policy gives from a given start.
 *
 * The policy cannot exceed the statutory six months — validatePolicy refuses
 * that — so this is a shorter probation where a company chose one, never a
 * longer one than the law allows.
 */
export function maxProbationEnd(join: Date, policy?: Partial<HrPolicy> | null): Date {
  const months = Math.min(MAX_PROBATION_MONTHS, withDefaults(policy).probationMonths);
  const whole = Math.floor(months);
  return new Date(Date.UTC(join.getUTCFullYear(), join.getUTCMonth() + whole, join.getUTCDate()));
}

/** Notice owed today: fourteen days on probation, the contract's figure after. */
export function noticeDaysFor(
  probationEnd: Date | null | undefined,
  contractNoticeDays: number | null | undefined,
  asAt: Date,
  policy?: Partial<HrPolicy> | null
): { days: number; reason: string } {
  const p = withDefaults(policy);
  if (probationState(probationEnd, asAt).onProbation) {
    return { days: p.probationNoticeDays, reason: "on probation" };
  }
  // The employee's own contract wins; the policy is what a contract that says
  // nothing falls back to.
  const d = Number(contractNoticeDays) || p.noticeDays;
  const clamped = Math.min(MAX_NOTICE_DAYS, Math.max(MIN_NOTICE_DAYS, d));
  return { days: clamped, reason: contractNoticeDays ? "per the contract" : "per company policy" };
}
