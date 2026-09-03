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

export type SeparationType = "Resignation" | "Termination" | "Termination (Misconduct)";

export type SettlementInput = {
  basicSalary: number;
  joinDate: Date;
  lastWorkingDay: Date;
  leaveBalanceDays: number;
  separationType: SeparationType;
  forfeitGratuity?: boolean; // gross misconduct
  pendingSalary?: number;
  noticePay?: number; // pay in lieu of notice owed TO the employee (+)
  airTicket?: number; // repatriation ticket, if in contract
  otherAdditions?: number;
  deductions?: number; // loans/advances/notice shortfall (−)
  adjustment?: number; // HR manual adjustment to the final amount, + or − (with a note)
};

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole years/months/days of service, plus a decimal-years figure for the gratuity formula. */
export function serviceLength(join: Date, last: Date) {
  const j = new Date(join), l = new Date(last);
  let years = l.getFullYear() - j.getFullYear();
  let months = l.getMonth() - j.getMonth();
  let days = l.getDate() - j.getDate();
  if (days < 0) { months -= 1; const pm = new Date(l.getFullYear(), l.getMonth(), 0).getDate(); days += pm; }
  if (months < 0) { years -= 1; months += 12; }
  const totalDays = Math.max(0, Math.floor((l.getTime() - j.getTime()) / DAY));
  const decimalYears = totalDays / 365.25;
  const text = years < 0 ? "—" : `${years}y ${months}m ${days}d`;
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days), decimalYears, totalDays, text };
}

/** Gratuity per the 21/30-day rule, min 1 year, capped at 2 years' basic pay. */
export function computeGratuity(basicSalary: number, decimalYears: number, forfeit = false) {
  const dailyBasic = basicSalary / 30;
  if (forfeit || decimalYears < 1) {
    return { eligible: false, days: 0, amount: 0, note: forfeit ? "Forfeited (gross misconduct)" : "Under 1 year of service — not eligible" };
  }
  const first5 = Math.min(decimalYears, 5);
  const after5 = Math.max(0, decimalYears - 5);
  const days = first5 * 21 + after5 * 30;
  const raw = days * dailyBasic;
  const cap = basicSalary * 24; // two years' basic pay
  const amount = Math.min(raw, cap);
  return { eligible: true, days: round2(days), amount: round2(amount), capped: raw > cap, note: raw > cap ? "Capped at 2 years' basic pay" : "" };
}

export type Settlement = ReturnType<typeof computeSettlement>;

export function computeSettlement(i: SettlementInput) {
  const svc = serviceLength(i.joinDate, i.lastWorkingDay);
  const dailyBasic = i.basicSalary / 30;
  const forfeit = i.forfeitGratuity ?? i.separationType === "Termination (Misconduct)";
  const gratuity = computeGratuity(i.basicSalary, svc.decimalYears, forfeit);

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
