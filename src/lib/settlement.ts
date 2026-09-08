/**
 * UAE End-of-Service (final settlement) calculator.
 * Based on Federal Decree-Law No. 33 of 2021 (UAE Labour Law, in force since Feb 2022).
 *
 * Gratuity (end-of-service benefit):
 *   - Paid only after at least 1 full year of continuous service.
 *   - Based on BASIC salary (allowances excluded). Daily wage = basic / 30.
 *   - First 5 years: 21 days of basic pay per year of service.
 *   - Each year beyond 5: 30 days of basic pay per year.
 *   - Partial years are paid pro-rata. Total gratuity is capped at 2 years' basic pay.
 *   - Under the current law, resignation and termination earn the SAME gratuity
 *     (the old limited/unlimited-contract reductions were removed). Dismissal for
 *     gross misconduct (Art. 44) can forfeit it — kept as an explicit option.
 *
 * Pure functions (no server-only import) so the form preview and the server action
 * compute identical numbers.
 */

import { type HrPolicy, withDefaults } from "./hrpolicy";

export type SeparationType = "Resignation" | "Termination" | "Termination (Misconduct)";

export type SettlementInput = {
  basicSalary: number;
  joinDate: Date;
  lastWorkingDay: Date;
  leaveBalanceDays: number;
  separationType: SeparationType;
  /**
   * Days of unpaid leave taken across the whole of service.
   *
   * Gratuity is earned on the service period, and unpaid leave is not part of
   * it — a man who took three months unpaid has three months less service than
   * the calendar says. Left out, every long absence is paid for twice: once by
   * not deducting the salary, and again in the end-of-service benefit.
   */
  unpaidLeaveDays?: number;
  forfeitGratuity?: boolean; // gross misconduct
  pendingSalary?: number;
  noticePay?: number; // pay in lieu of notice owed TO the employee (+)
  airTicket?: number; // repatriation ticket, if in contract
  otherAdditions?: number;
  deductions?: number; // loans/advances/notice shortfall (−)
  adjustment?: number; // HR manual adjustment to the final amount, + or − (with a note)
  /** The company's handbook. A company may be more generous than the law. */
  policy?: Partial<HrPolicy> | null;
};

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whole years/months/days of service, plus a decimal-years figure for the
 * gratuity formula.
 *
 * Service is measured by calendar anniversary, not by dividing elapsed days by
 * 365.25. Two reasons, both of which cost the employee money:
 *
 *   - An average-length year is 365.25 days, so a real year of 365 days came to
 *     0.99932 and an employee who had served exactly one year was told they had
 *     not. The screen showed "1y 0m 0d" beside "under 1 year — not eligible".
 *     Three years in four contain no 29 February, so this was the common case,
 *     and a completed year is a statutory entitlement under Decree-Law 33/2021.
 *   - The same divisor made every settlement fractionally short — always in the
 *     employer's favour, which is the wrong direction in a labour claim.
 *
 * Dates are stored as UTC midnight, so this reads them in UTC. Local getters
 * would shift the day either side of midnight and make the answer depend on
 * where the server happens to run.
 */
export function serviceLength(join: Date, last: Date) {
  const j = new Date(join), l = new Date(last);
  let years = l.getUTCFullYear() - j.getUTCFullYear();
  let months = l.getUTCMonth() - j.getUTCMonth();
  let days = l.getUTCDate() - j.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Day count of the month before the last working day.
    const pm = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 0)).getUTCDate();
    days += pm;
  }
  if (months < 0) { years -= 1; months += 12; }
  const totalDays = Math.max(0, Math.floor((l.getTime() - j.getTime()) / DAY));

  const wholeYears = Math.max(0, years);
  // The part-year is measured against the length of the service year actually
  // being served, so a year that contains 29 February is not counted short.
  const since = new Date(Date.UTC(j.getUTCFullYear() + wholeYears, j.getUTCMonth(), j.getUTCDate()));
  const until = new Date(Date.UTC(j.getUTCFullYear() + wholeYears + 1, j.getUTCMonth(), j.getUTCDate()));
  const yearLength = Math.max(1, Math.round((until.getTime() - since.getTime()) / DAY));
  const elapsed = Math.max(0, Math.round((l.getTime() - since.getTime()) / DAY));
  const decimalYears = l < j ? 0 : wholeYears + Math.min(1, elapsed / yearLength);

  const text = years < 0 ? "—" : `${years}y ${months}m ${days}d`;
  return { years: wholeYears, months: Math.max(0, months), days: Math.max(0, days), decimalYears, totalDays, text };
}

/**
 * Gratuity: 21 days a year for the first five and 30 after, a year of service
 * before any is earned, capped at two years' basic pay.
 *
 * Every one of those is a statutory MINIMUM, and a company may promise better —
 * so they come from the policy, which validatePolicy refuses to let anybody set
 * below the law.
 */
export function computeGratuity(
  basicSalary: number,
  decimalYears: number,
  forfeit = false,
  policy?: Partial<HrPolicy> | null
) {
  const p = withDefaults(policy);
  const dailyBasic = basicSalary / p.daysPerMonth;
  if (forfeit || decimalYears < p.gratuityMinYears) {
    return {
      eligible: false,
      days: 0,
      amount: 0,
      note: forfeit
        ? "Forfeited (gross misconduct)"
        : `Under ${p.gratuityMinYears} year${p.gratuityMinYears === 1 ? "" : "s"} of service — not eligible`,
    };
  }
  const first5 = Math.min(decimalYears, 5);
  const after5 = Math.max(0, decimalYears - 5);
  const days = first5 * p.gratuityFirst5Days + after5 * p.gratuityAfter5Days;
  const raw = days * dailyBasic;
  const cap = basicSalary * 12 * p.gratuityCapYears;
  const amount = Math.min(raw, cap);
  return {
    eligible: true,
    days: round2(days),
    amount: round2(amount),
    capped: raw > cap,
    note: raw > cap ? `Capped at ${p.gratuityCapYears} years' basic pay` : "",
  };
}

export type Settlement = ReturnType<typeof computeSettlement>;

export function computeSettlement(i: SettlementInput) {
  // Unpaid leave is taken off the end of the service period rather than
  // adjusted afterwards, so it works the same way at every boundary — including
  // the one that matters most, where a long absence drops somebody back under
  // the year that earns any gratuity at all.
  const unpaid = Math.max(0, Number(i.unpaidLeaveDays) || 0);
  const effectiveLast = unpaid > 0
    ? new Date(i.lastWorkingDay.getTime() - unpaid * DAY)
    : i.lastWorkingDay;
  const p = withDefaults(i.policy);
  const svc = serviceLength(i.joinDate, effectiveLast);
  const dailyBasic = i.basicSalary / p.daysPerMonth;
  const forfeit = i.forfeitGratuity ?? i.separationType === "Termination (Misconduct)";
  const gratuity = computeGratuity(i.basicSalary, svc.decimalYears, forfeit, p);

  const leaveDays = Math.max(0, i.leaveBalanceDays || 0);
  const leaveAmount = round2(dailyBasic * leaveDays);

  const pendingSalary = round2(i.pendingSalary ?? 0);
  const noticePay = round2(i.noticePay ?? 0);
  const airTicket = round2(i.airTicket ?? 0);
  const otherAdditions = round2(i.otherAdditions ?? 0);
  const deductions = round2(i.deductions ?? 0);
  const adjustment = round2(i.adjustment ?? 0); // HR manual +/− tweak

  const totalAdditions = round2(gratuity.amount + leaveAmount + pendingSalary + noticePay + airTicket + otherAdditions);
  const netSettlement = round2(totalAdditions - deductions + adjustment);

  return {
    service: svc,
    dailyBasic: round2(dailyBasic),
    gratuity, leaveDays, leaveAmount,
    pendingSalary, noticePay, airTicket, otherAdditions, deductions, adjustment,
    totalAdditions, netSettlement,
  };
}
