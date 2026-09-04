/**
 * UAE Wage Protection System (WPS) — SIF (Salary Information File) builder.
 * Produces the delimited file banks/MOHRE accept to process a payroll:
 *   - one SCR (Salary Control Record) header line, then
 *   - one EDR (Employee Detail Record) line per employee.
 * Pure functions (no server-only) so they can be unit-tested.
 */

export type SifEmployer = { employerId: string; routing: string };
export type SifEmployee = {
  personId: string;   // employee MOL / labour-card ID
  routing: string;    // employee bank routing (agent) code
  iban: string;
  fixed: number;      // fixed income (basic)
  variable: number;   // variable income (allowances net of deductions)
  days: number;       // days worked in the period
  leaveDays?: number;
};

const two = (n: number) => String(n).padStart(2, "0");
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Last day of the "YYYY-MM" period. */
export function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${two(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${two(m)}-${two(lastDay)}`;
  return { start, end, days: lastDay, salaryMonth: `${two(m)}${y}` };
}

/** Build the SIF text (SCR header first, then EDR records). */
export function buildSif(employer: SifEmployer, employees: SifEmployee[], period: string, now = new Date()): string {
  const { start, end, salaryMonth } = periodBounds(period);
  const fileDate = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const fileTime = `${two(now.getHours())}${two(now.getMinutes())}`;
  const total = employees.reduce((s, e) => s + e.fixed + e.variable, 0);

  const edr = employees.map((e) =>
    ["EDR", e.personId, e.routing, e.iban, start, end, String(e.days), amt(e.fixed), amt(e.variable), String(e.leaveDays ?? 0)].join(","),
  );
  const scr = ["SCR", employer.employerId, employer.routing, fileDate, fileTime, salaryMonth,
    String(employees.length), amt(total), String(employees.length + 1), "AED"].join(",");

  return [scr, ...edr].join("\r\n") + "\r\n";
}

/** Split a net pay into WPS fixed/variable so fixed + variable == net. */
export function splitFixedVariable(basic: number, netPay: number) {
  const fixed = Math.min(basic, netPay);
  return { fixed, variable: Math.max(0, netPay - fixed) };
}
