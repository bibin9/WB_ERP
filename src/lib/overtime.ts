/**
 * Overtime — what it cost, and where it broke the law.
 *
 * Payroll has been computing overtime correctly for months and storing the
 * hours on every payslip; nothing was adding them up. So two questions had no
 * answer: what is overtime costing us, and is anybody working more of it than
 * the law allows. The second one matters more than it sounds — Article 19 caps
 * ordinary overtime at two hours a day, and a MOHRE inspection reads the
 * attendance record, not the payslip.
 *
 * Pure arithmetic, no database, so the rules can be tested directly.
 */

/** Article 19: two hours a day, unless the work prevents a serious loss. */
export const STATUTORY_MAX_OT_PER_DAY = 2;
/** Article 17/19: 144 hours over any three weeks, overtime included. */
export const STATUTORY_MAX_HOURS_PER_3_WEEKS = 144;
export const ROLLING_WINDOW_DAYS = 21;

const round = (n: number) => Math.round(n * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;

export type OvertimePolicy = {
  /** The company's own cap. May be stricter than the statute, never looser. */
  maxOvertimeHoursPerDay: number;
  maxHoursPerThreeWeeks: number;
  normalHoursPerDay: number;
};

export const DEFAULT_OVERTIME_POLICY: OvertimePolicy = {
  maxOvertimeHoursPerDay: STATUTORY_MAX_OT_PER_DAY,
  maxHoursPerThreeWeeks: STATUTORY_MAX_HOURS_PER_3_WEEKS,
  normalHoursPerDay: 8,
};

/* ======================= what it cost ==================================== */

export type PayslipOt = {
  employeeId: string;
  empNo: string;
  employeeName: string;
  department?: string | null;
  period: string; // "2026-08"
  basic: number;
  otHours: number;
  otPremiumHours: number;
  overtime: number;
};

export type OvertimeRow = {
  employeeId: string;
  empNo: string;
  employeeName: string;
  department: string;
  otHours: number;
  otPremiumHours: number;
  totalHours: number;
  cost: number;
  basic: number;
  /** Overtime as a share of basic pay. The number that starts conversations. */
  shareOfBasic: number;
  periods: number;
};

export type OvertimeSummary = {
  rows: OvertimeRow[];
  totals: { otHours: number; otPremiumHours: number; totalHours: number; cost: number; basic: number };
  /** Cost by month, oldest first, for the trend. */
  byPeriod: { period: string; hours: number; cost: number }[];
  /** People whose overtime is more than this share of their basic pay. */
  heavy: OvertimeRow[];
};

/**
 * Roll payslip lines up by person.
 *
 * A share of basic above this is not illegal and is worth a look: it usually
 * means either an understaffed crew or a rate that has drifted.
 */
export const HEAVY_OT_SHARE = 0.5;

export function summariseOvertime(slips: PayslipOt[]): OvertimeSummary {
  const byEmployee = new Map<string, OvertimeRow>();
  const byPeriod = new Map<string, { hours: number; cost: number }>();

  for (const s of slips) {
    const hours = round(s.otHours + s.otPremiumHours);
    const row = byEmployee.get(s.employeeId) ?? {
      employeeId: s.employeeId, empNo: s.empNo, employeeName: s.employeeName,
      department: s.department || "—",
      otHours: 0, otPremiumHours: 0, totalHours: 0, cost: 0, basic: 0, shareOfBasic: 0, periods: 0,
    };
    row.otHours = round(row.otHours + s.otHours);
    row.otPremiumHours = round(row.otPremiumHours + s.otPremiumHours);
    row.totalHours = round(row.totalHours + hours);
    row.cost = round(row.cost + s.overtime);
    row.basic = round(row.basic + s.basic);
    row.periods += 1;
    byEmployee.set(s.employeeId, row);

    const p = byPeriod.get(s.period) ?? { hours: 0, cost: 0 };
    p.hours = round(p.hours + hours);
    p.cost = round(p.cost + s.overtime);
    byPeriod.set(s.period, p);
  }

  const rows = [...byEmployee.values()]
    .map((r) => ({ ...r, shareOfBasic: r.basic > 0 ? round(r.cost / r.basic) : 0 }))
    // Costliest first: the report is read from the top and acted on there.
    .sort((a, b) => b.cost - a.cost || a.employeeName.localeCompare(b.employeeName));

  const totals = rows.reduce(
    (t, r) => ({
      otHours: round(t.otHours + r.otHours),
      otPremiumHours: round(t.otPremiumHours + r.otPremiumHours),
      totalHours: round(t.totalHours + r.totalHours),
      cost: round(t.cost + r.cost),
      basic: round(t.basic + r.basic),
    }),
    { otHours: 0, otPremiumHours: 0, totalHours: 0, cost: 0, basic: 0 },
  );

  return {
    rows,
    totals,
    byPeriod: [...byPeriod.entries()]
      .map(([period, v]) => ({ period, ...v }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    heavy: rows.filter((r) => r.shareOfBasic > HEAVY_OT_SHARE),
  };
}

/* ======================= where it broke the law ========================== */

export type AttendanceDay = {
  employeeId: string;
  empNo: string;
  employeeName: string;
  date: Date;
  hours: number;
  otHours: number;
  otPremiumHours: number;
};

export type DailyBreach = {
  employeeId: string;
  empNo: string;
  employeeName: string;
  date: Date;
  otHours: number;
  limit: number;
};

export type RollingBreach = {
  employeeId: string;
  empNo: string;
  employeeName: string;
  from: Date;
  to: Date;
  hours: number;
  limit: number;
};

/**
 * Days where somebody worked more overtime than the cap allows.
 *
 * Both kinds of overtime count towards the daily cap: the law limits hours
 * worked, and does not care what rate they were paid at.
 */
export function dailyBreaches(days: AttendanceDay[], policy: OvertimePolicy): DailyBreach[] {
  const limit = policy.maxOvertimeHoursPerDay;
  return days
    .filter((d) => round(d.otHours + d.otPremiumHours) > limit + 1e-9)
    .map((d) => ({
      employeeId: d.employeeId, empNo: d.empNo, employeeName: d.employeeName,
      date: d.date, otHours: round(d.otHours + d.otPremiumHours), limit,
    }))
    .sort((a, b) => b.otHours - a.otHours || a.date.getTime() - b.date.getTime());
}

/**
 * Any three-week window in which total hours exceeded the cap.
 *
 * Every window is tested rather than fixed calendar blocks, because the statute
 * says "any three weeks" — a run that straddles two calendar periods is still a
 * breach, and testing only fixed blocks is how it would be missed. Only the
 * worst window per person is reported; twenty overlapping windows describing
 * one bad fortnight is noise, not twenty findings.
 */
export function rollingBreaches(days: AttendanceDay[], policy: OvertimePolicy): RollingBreach[] {
  const limit = policy.maxHoursPerThreeWeeks;
  const byEmployee = new Map<string, AttendanceDay[]>();
  for (const d of days) {
    const list = byEmployee.get(d.employeeId) ?? [];
    list.push(d);
    byEmployee.set(d.employeeId, list);
  }

  const out: RollingBreach[] = [];
  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    let worst: RollingBreach | null = null;

    for (let i = 0; i < sorted.length; i++) {
      const from = sorted[i].date;
      const to = new Date(from.getTime() + (ROLLING_WINDOW_DAYS - 1) * DAY);
      let hours = 0;
      for (let j = i; j < sorted.length && sorted[j].date.getTime() <= to.getTime(); j++) {
        hours = round(hours + sorted[j].hours + sorted[j].otHours + sorted[j].otPremiumHours);
      }
      if (hours > limit + 1e-9 && (!worst || hours > worst.hours)) {
        worst = {
          employeeId, empNo: sorted[i].empNo, employeeName: sorted[i].employeeName,
          from, to, hours, limit,
        };
      }
    }
    if (worst) out.push(worst);
  }

  return out.sort((a, b) => b.hours - a.hours);
}

/** One sentence for the top of the screen. */
export function overtimeVerdict(
  s: OvertimeSummary,
  daily: DailyBreach[],
  rolling: RollingBreach[],
): { tone: "good" | "watch" | "bad"; text: string } {
  const people = new Set([...daily.map((d) => d.employeeId), ...rolling.map((r) => r.employeeId)]).size;
  if (people > 0) {
    return {
      tone: "bad",
      text: `${people} ${people === 1 ? "person has" : "people have"} worked more overtime than the law allows. An inspection reads the attendance record, so fix the roster rather than the payslip.`,
    };
  }
  if (s.heavy.length > 0) {
    return {
      tone: "watch",
      text: `Nobody is over the legal cap, but ${s.heavy.length} ${s.heavy.length === 1 ? "person is" : "people are"} earning more than half their basic pay in overtime. That is usually a crew that is short-handed.`,
    };
  }
  return { tone: "good", text: "Overtime is inside the legal caps, and nobody is unusually dependent on it." };
}
