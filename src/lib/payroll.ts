/**
 * UAE monthly payroll.
 *
 * Federal Decree-Law 33 of 2021 and its Executive Regulations. What a site
 * payroll actually has to get right, none of which is a flat monthly figure:
 *
 *   - overtime, which for a technical-services contractor is most of the
 *     variation between one man's month and the next;
 *   - part months, because riggers and welders join and leave mid-month and a
 *     full month's pay for eleven days' work is money out of the door;
 *   - unpaid absence and the sick-pay ladder, which is the money coming back.
 *
 * Every rate here is statutory, so they are named constants with the article
 * behind them rather than numbers buried in an expression.
 *
 * Pure functions, no server-only import: the payroll screen previews a payslip
 * as it is edited and the server action computes the same numbers.
 */

/** A normal working day. Art. 17: eight hours, forty-eight a week. */
export const NORMAL_HOURS_PER_DAY = 8;

/**
 * The divisor for a daily wage.
 *
 * Thirty, always, whatever the month holds — this is the figure MOHRE uses and
 * the one gratuity and leave encashment already use in lib/settlement.ts.
 * Overtime is priced off it, so an hour is worth the same in February as in
 * March.
 */
export const DAYS_PER_MONTH = 30;

/**
 * Overtime multipliers, on BASIC pay, from Art. 19 of the Executive
 * Regulations.
 *
 *   - 125% for ordinary overtime;
 *   - 150% for hours between 22:00 and 04:00, and for work on a rest day or a
 *     public holiday where a day off in lieu is not given.
 *
 * Shift workers whose pattern normally falls at night are outside the night
 * uplift, which is a fact about the contract rather than the clock — so the
 * premium hours are a figure HR sets, not one the system infers on its own.
 */
export const OT_NORMAL_RATE = 1.25;
export const OT_PREMIUM_RATE = 1.5;

/** The night window that attracts the higher rate. */
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_TO_HOUR = 4;

/**
 * Sick leave, Art. 31: ninety days in a year of service, in three bands.
 * The first fifteen at full pay, the next thirty at half, the last
 * forty-five unpaid. Beyond ninety there is no entitlement at all.
 */
export const SICK_FULL_DAYS = 15;
export const SICK_HALF_DAYS = 30;
export const SICK_UNPAID_DAYS = 45;
export const SICK_TOTAL_DAYS = SICK_FULL_DAYS + SICK_HALF_DAYS + SICK_UNPAID_DAYS;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const DAY_MS = 86_400_000;

/** One hour of basic pay — what overtime is priced from. */
export const hourlyBasic = (basic: number): number =>
  (Number(basic) || 0) / DAYS_PER_MONTH / NORMAL_HOURS_PER_DAY;

/** One day of full pay, used for absence and unpaid leave. */
export const dailyRate = (basic: number, allowances: number, daysInPeriod: number): number =>
  ((Number(basic) || 0) + (Number(allowances) || 0)) / Math.max(1, daysInPeriod);

/**
 * Overtime pay, split so the payslip can show its working.
 *
 * A man who cannot see how his overtime was arrived at assumes he has been
 * short-changed, and on a site that becomes everybody's problem by lunchtime.
 */
export function overtimePay(basic: number, otHours: number, otPremiumHours: number) {
  const rate = hourlyBasic(basic);
  const normal = round2(Math.max(0, Number(otHours) || 0) * rate * OT_NORMAL_RATE);
  const premium = round2(Math.max(0, Number(otPremiumHours) || 0) * rate * OT_PREMIUM_RATE);
  return { hourlyRate: round2(rate), normal, premium, total: round2(normal + premium) };
}

/**
 * Split a day's worked hours into normal and overtime.
 *
 * Anything past the eighth hour is overtime. The night portion is worked out
 * from the punches when they are known — the overlap of the worked window with
 * 22:00 to 04:00 — because on a shutdown the difference between 125% and 150%
 * is the difference between the payslip and a complaint.
 */
export function splitDayHours(
  hours: number,
  firstIn?: Date | null,
  lastOut?: Date | null
): { normal: number; ot: number; otPremium: number } {
  const worked = Math.max(0, Number(hours) || 0);
  const normal = Math.min(worked, NORMAL_HOURS_PER_DAY);
  const ot = round2(Math.max(0, worked - NORMAL_HOURS_PER_DAY));
  if (ot <= 0 || !firstIn || !lastOut) return { normal: round2(normal), ot, otPremium: 0 };

  const night = round2(Math.min(ot, nightHours(firstIn, lastOut)));
  return { normal: round2(normal), ot: round2(ot - night), otPremium: night };
}

/**
 * Hours of a shift that fall inside the night window.
 *
 * The window wraps midnight, so it is measured as two ranges against the shift
 * rather than one comparison — 22:00 to midnight, and midnight to 04:00 — for
 * each calendar day the shift touches.
 */
export function nightHours(firstIn: Date, lastOut: Date): number {
  const start = firstIn.getTime();
  const end = lastOut.getTime();
  if (!(end > start)) return 0;

  let total = 0;
  // Walk each day the shift touches, and add both halves of that day's window.
  const first = new Date(firstIn);
  first.setHours(0, 0, 0, 0);
  for (let d = first.getTime(); d <= end; d += DAY_MS) {
    const midnight = new Date(d);
    const evening = new Date(midnight).setHours(NIGHT_FROM_HOUR, 0, 0, 0);
    const dawn = new Date(midnight).setHours(NIGHT_TO_HOUR, 0, 0, 0);
    total += overlap(start, end, evening, d + DAY_MS);
    total += overlap(start, end, d, dawn);
  }
  return round2(total / 3_600_000);
}

const overlap = (aFrom: number, aTo: number, bFrom: number, bTo: number) =>
  Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));

/**
 * How much of the period a person was actually on the payroll.
 *
 * A whole month is a whole month's pay whatever its length — February does not
 * pay less than March. Only a part month is divided, and it is divided by the
 * days that month really has, so eleven days of a thirty-day September is
 * eleven thirtieths and nine days of a twenty-eight-day February is nine
 * twenty-eighths. Dividing a part month by a flat thirty would quietly short
 * every February leaver.
 */
export function payableDays(
  periodStart: Date,
  periodEnd: Date,
  joinDate?: Date | null,
  lastWorkingDay?: Date | null
) {
  const daysInPeriod = Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS) + 1;

  const from = joinDate && joinDate > periodStart ? joinDate : periodStart;
  const to = lastWorkingDay && lastWorkingDay < periodEnd ? lastWorkingDay : periodEnd;

  // Joined after the month ended, or left before it began: nothing is due.
  if (to < from) return { daysInPeriod, daysPaid: 0, partMonth: true, reason: "not employed in this month" };

  const daysPaid = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const partMonth = daysPaid < daysInPeriod;
  const reason = !partMonth
    ? ""
    : joinDate && joinDate > periodStart && lastWorkingDay && lastWorkingDay < periodEnd
      ? `joined ${iso(joinDate)} and left ${iso(lastWorkingDay)}`
      : joinDate && joinDate > periodStart
        ? `joined ${iso(joinDate)}`
        : `last working day ${iso(lastWorkingDay!)}`;

  return { daysInPeriod, daysPaid: Math.min(daysPaid, daysInPeriod), partMonth, reason };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The sick-pay ladder, applied against what the employee has already taken in
 * the same year of service.
 *
 * Taken in order: the full-pay days first, then the half-pay ones, then the
 * unpaid. A man who has already had twenty days this year and takes ten more
 * gets none at full pay and all ten at half.
 */
export function sickSplit(alreadyTaken: number, days: number) {
  const before = Math.max(0, Number(alreadyTaken) || 0);
  const take = Math.max(0, Number(days) || 0);

  const band = (from: number, size: number) => {
    const start = Math.max(before, from);
    const end = Math.min(before + take, from + size);
    return Math.max(0, end - start);
  };

  const full = band(0, SICK_FULL_DAYS);
  const half = band(SICK_FULL_DAYS, SICK_HALF_DAYS);
  const unpaid = band(SICK_FULL_DAYS + SICK_HALF_DAYS, SICK_UNPAID_DAYS);
  // Past ninety days there is no entitlement, so those days are unpaid too.
  const beyond = Math.max(0, before + take - SICK_TOTAL_DAYS) - Math.max(0, before - SICK_TOTAL_DAYS);

  return {
    full: round2(full),
    half: round2(half),
    unpaid: round2(unpaid + beyond),
    /** Days that cost the employee pay, counted in whole-day equivalents. */
    unpaidEquivalent: round2(half * 0.5 + unpaid + beyond),
    exhausted: before + take > SICK_TOTAL_DAYS,
  };
}

export type PayslipInput = {
  basic: number;
  allowances: number;
  periodStart: Date;
  periodEnd: Date;
  joinDate?: Date | null;
  lastWorkingDay?: Date | null;
  otHours?: number;
  otPremiumHours?: number;
  /** Days of approved unpaid leave falling in the period. */
  unpaidLeaveDays?: number;
  /** Whole-day equivalents lost to the sick ladder (half-pay days count a half). */
  sickUnpaidDays?: number;
  /** Days marked Absent on the muster with no leave behind them. */
  absentDays?: number;
  /** Fines, recoveries and anything else HR enters by hand. */
  otherDeductions?: number;
  advanceRecovery?: number;
};

/**
 * One payslip, from the contract and the month's attendance.
 *
 * Everything is derived rather than typed, except the manual deduction — which
 * is the only figure a person should be keying, and the only one they can get
 * wrong without the system knowing.
 */
export function computePayslip(i: PayslipInput) {
  const days = payableDays(i.periodStart, i.periodEnd, i.joinDate, i.lastWorkingDay);
  const share = days.daysInPeriod > 0 ? days.daysPaid / days.daysInPeriod : 0;

  const basic = round2((Number(i.basic) || 0) * share);
  const allowances = round2((Number(i.allowances) || 0) * share);

  // Overtime is priced on the contractual basic, not the prorated one: an hour
  // worked is an hour worked regardless of when in the month somebody joined.
  const ot = overtimePay(i.basic, i.otHours ?? 0, i.otPremiumHours ?? 0);

  const unpaidDays = round2(
    Math.max(0, i.unpaidLeaveDays ?? 0) +
      Math.max(0, i.sickUnpaidDays ?? 0) +
      Math.max(0, i.absentDays ?? 0)
  );
  const perDay = dailyRate(i.basic, i.allowances, days.daysInPeriod);
  // Never claw back more than was earned in the first place.
  const absenceDeduction = round2(Math.min(unpaidDays * perDay, basic + allowances));

  const otherDeductions = round2(Math.max(0, i.otherDeductions ?? 0));
  const advanceRecovery = round2(Math.max(0, i.advanceRecovery ?? 0));

  const gross = round2(basic + allowances + ot.total);
  const netPay = round2(gross - absenceDeduction - otherDeductions - advanceRecovery);

  return {
    ...days,
    basic,
    allowances,
    contractBasic: round2(i.basic),
    contractAllowances: round2(i.allowances),
    otHours: round2(i.otHours ?? 0),
    otPremiumHours: round2(i.otPremiumHours ?? 0),
    overtime: ot.total,
    overtimeDetail: ot,
    unpaidDays,
    dailyRate: round2(perDay),
    absenceDeduction,
    otherDeductions,
    advanceRecovery,
    gross,
    /** Negative pay is always a data error, never a real instruction. */
    netPay: Math.max(0, netPay),
    overRecovered: netPay < 0,
  };
}

/**
 * Whether an employee can safely be put on a run.
 *
 * The bank rejects a WPS file on one malformed row and names none of them, so
 * the check happens here — before the run exists — rather than at download,
 * where a man with one mistyped digit in his IBAN is quietly dropped from the
 * file and finds out on payday.
 */
export function payrollReadiness(e: {
  name: string;
  basicSalary: number;
  iban?: string | null;
  labourCardNo?: string | null;
  bankRoutingCode?: string | null;
  joinDate?: Date | null;
}, validators: {
  iban: (v: string) => { error?: string };
  labourCard: (v: string) => { error?: string };
  routing: (v: string) => { error?: string };
}): string[] {
  const problems: string[] = [];
  if (!(Number(e.basicSalary) > 0)) problems.push("no basic salary");
  if (!e.joinDate) problems.push("no join date");
  if (!e.iban) problems.push("no IBAN");
  else if (validators.iban(e.iban).error) problems.push(validators.iban(e.iban).error!);
  if (!e.labourCardNo) problems.push("no labour-card number");
  else if (validators.labourCard(e.labourCardNo).error) problems.push(validators.labourCard(e.labourCardNo).error!);
  if (!e.bankRoutingCode) problems.push("no bank routing code");
  else if (validators.routing(e.bankRoutingCode).error) problems.push(validators.routing(e.bankRoutingCode).error!);
  return problems;
}
