/**
 * Getting labour onto a job.
 *
 * Hours were recorded and salaries were posted, but nothing connected the two,
 * so a job showed only its materials and subcontractors. On a technical-services
 * contract labour is usually the largest single cost, so every margin on the job
 * screen read better than the truth.
 *
 * The fix is absorption, which is what ERPNext, Odoo and a Tally user with cost
 * centres all do:
 *
 *   Dr  5100 Site Labour        (tagged to the job)
 *   Cr  6900 Labour Recovered   (a contra-expense)
 *
 * Payroll still posts the real wage bill to 6000 Salaries & Wages. The pair
 * above nets to nil in the P&L, so nothing is counted twice, while job costing
 * finally sees the labour. The difference between 6000 and 6900 is the wage cost
 * that was never charged to a job — idle time, and worth knowing.
 *
 * Not server-only: the timesheet form previews the rate before saving.
 */

/** Where absorbed labour lands, and where it is recovered from. */
export const LABOUR_COST_CODE = "5100";
export const LABOUR_RECOVERED_CODE = "6900";

/**
 * Hours a monthly salary is spread over.
 *
 * A UAE contract is normally 8 hours a day, six days a week — about 26 working
 * days a month. Dividing by 30 x 8 would understate the hourly cost by a
 * seventh, so a job would be under-charged for every hour worked on it.
 */
export const STANDARD_MONTHLY_HOURS = 208;

export type Payable = {
  basicSalary: number;
  allowances: number;
  /** Set when the real cost differs from the package. */
  hourlyCost?: number | null;
};

/**
 * What one hour of this person's time costs the business.
 *
 * An explicit hourlyCost wins — a supplied worker is charged at the agency rate,
 * which has nothing to do with what appears on their own payslip. Otherwise the
 * whole package is spread over standard hours, because the employer pays
 * allowances whether or not anyone is on site.
 */
export function hourlyCostFor(e: Payable): number {
  if (e.hourlyCost != null && e.hourlyCost > 0) return e.hourlyCost;
  const monthly = (Number(e.basicSalary) || 0) + (Number(e.allowances) || 0);
  if (monthly <= 0) return 0;
  return monthly / STANDARD_MONTHLY_HOURS;
}

/** What a timesheet line costs: hours at the rate snapshotted on it. */
export const lineCost = (hours: number, costRate: number): number =>
  (Number(hours) || 0) * (Number(costRate) || 0);

/** Plain-English explanation of where a derived rate came from, for the form. */
export function rateExplanation(e: Payable): string {
  if (e.hourlyCost != null && e.hourlyCost > 0) {
    return `Set for this employee: ${e.hourlyCost.toFixed(2)} per hour.`;
  }
  const monthly = (Number(e.basicSalary) || 0) + (Number(e.allowances) || 0);
  if (monthly <= 0) return "No salary on record, so this time has no cost against the job yet.";
  return (
    `${monthly.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a month ` +
    `over ${STANDARD_MONTHLY_HOURS} standard hours = ` +
    `${hourlyCostFor(e).toFixed(2)} per hour.`
  );
}
