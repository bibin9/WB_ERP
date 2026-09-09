/**
 * One company's finance settings.
 *
 * Two different kinds of thing live here, and they are configurable for two
 * different reasons.
 *
 * The chart of accounts is the customer's own. A contractor who has run Tally
 * for fifteen years has salaries on 5010, not 6000, and telling them to
 * renumber their ledger to suit our software is not an answer — so every place
 * the system posts is a named ROLE ("where wages go", "where the bank is") that
 * points at whatever code that company actually uses. Nothing in the code names
 * a number any more.
 *
 * The tax rates are the law's, and the law moves. VAT has been five per cent
 * since 2018 and corporate tax nine since 2023, but Small Business Relief has
 * already been extended once and the Emiratisation contribution has risen every
 * year. A rate that can only be changed by a developer is a rate that will be
 * wrong the week it changes. So they are settings — with the current figure as
 * the default, a note saying what the law says today, and a warning on the
 * screen that changing one changes what gets filed.
 *
 * What is NOT configurable is arithmetic. Debits equal credits, a voucher
 * cannot post into another company's accounts, a payslip cannot go negative.
 * Those are not policies anybody should be able to switch off; making them
 * optional would be making the software wrong on request.
 *
 * Pure: the settings form validates as it is typed, and the server validates
 * the same way when it saves.
 */

/**
 * Every place the system posts to, as a role rather than a number.
 *
 * Adding one here is the only way a new posting should ever name an account —
 * if a module reaches for a literal code again, this file has failed.
 */
export const ACCOUNT_ROLES = [
  { key: "bank", label: "Bank", code: "1000", why: "Where money actually moves — payroll, cheques, receipts." },
  { key: "accountsReceivable", label: "Accounts receivable", code: "1100", why: "What customers owe. Retention is released back into it." },
  { key: "accountsPayable", label: "Accounts payable", code: "2000", why: "What you owe suppliers and subcontractors." },
  { key: "vatInput", label: "VAT input (recoverable)", code: "1150", why: "VAT you have paid and can reclaim. Box 10 of the return is agreed to it." },
  { key: "vatOutput", label: "VAT output (payable)", code: "2150", why: "VAT you have charged and owe the FTA. Box 12 is agreed to it." },
  { key: "retentionReceivable", label: "Retention receivable", code: "1160", why: "Retention a client is holding from you." },
  { key: "retentionPayable", label: "Retention payable", code: "2200", why: "Retention you are holding from a subcontractor." },
  { key: "labourCost", label: "Site labour", code: "5100", why: "Where charged labour hours land, tagged to the job." },
  { key: "labourRecovered", label: "Labour recovered", code: "6900", why: "The other side of absorption costing. Nets against site labour in the P&L." },
  { key: "salaryExpense", label: "Salaries & wages", code: "6000", why: "Where the monthly payroll cost goes." },
  { key: "employeeAdvances", label: "Employee advances", code: "1170", why: "Salary advances owed back. An asset until recovered, not a cost." },
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number]["key"];

export type FinancePolicy = {
  /** Role → the account code this company actually uses. */
  accounts: Record<AccountRole, string>;

  /* ------------------------------------------------------------------ tax - */
  /** UAE VAT. Five per cent since January 2018. */
  vatRate: number;
  /** Corporate tax above the band. Nine per cent since June 2023. */
  corporateTaxRate: number;
  /** Taxable income taxed at nil. AED 375,000. */
  corporateTaxBand: number;
  /** Revenue ceiling for Small Business Relief. AED 3,000,000. */
  sbrRevenueCap: number;
  /** Share of taxable income brought-forward losses may relieve. 75%. */
  lossReliefCap: number;
  /** Months after the tax period that the return and payment are due. Nine. */
  filingMonths: number;

  /* ---------------------------------------------------------- operations - */
  /** Day of the month wages are paid, which the cash flow forecast turns on. */
  payrollDayOfMonth: number;
  /**
   * eInvoicing identifiers, and who transmits for us.
   *
   * Text rather than numbers, and blank by default: the Ministry of Finance
   * publishes the identifiers and revises them, and an accredited service
   * provider hands its customers the exact values. Guessing them would produce
   * documents rejected for a reason nobody could see, so nothing is assumed.
   */
  eInvoiceCustomizationId: string;
  eInvoiceProfileId: string;
  eInvoiceProvider: string;
  /** A cheque older than this is stale and a bank will refuse it. */
  chequeStaleDays: number;
  /** What a contract usually retains, offered as the default on the form. */
  defaultRetentionPercent: number;
  /** How far ahead a visa, licence or certificate is flagged as expiring. */
  expiryWarningDays: number;
  /** Rows per page on the grids. */
  pageSize: number;
};

/** What the law and ordinary practice say today, and what a new company gets. */
export const DEFAULT_FINANCE_POLICY: FinancePolicy = {
  accounts: Object.fromEntries(ACCOUNT_ROLES.map((r) => [r.key, r.code])) as Record<AccountRole, string>,

  vatRate: 0.05,
  corporateTaxRate: 0.09,
  corporateTaxBand: 375_000,
  sbrRevenueCap: 3_000_000,
  lossReliefCap: 0.75,
  filingMonths: 9,

  eInvoiceCustomizationId: "",
  eInvoiceProfileId: "",
  eInvoiceProvider: "",
  payrollDayOfMonth: 28,
  chequeStaleDays: 180,
  defaultRetentionPercent: 10,
  expiryWarningDays: 60,
  pageSize: 50,
};

/**
 * The statutory figures as they stand, so the screen can say "the law says
 * this" beside "you have set that" — and so a customer who changes one on a
 * rumour can see what they moved away from.
 */
export const STATUTORY_NOTE: Record<string, string> = {
  vatRate: "5% since January 2018.",
  corporateTaxRate: "9% above the band, since June 2023.",
  corporateTaxBand: "AED 375,000 of taxable income at nil.",
  sbrRevenueCap: "AED 3,000,000 of revenue, for periods ending on or before 31 December 2029.",
  lossReliefCap: "Brought-forward losses relieve at most 75% of taxable income.",
  filingMonths: "The return and the payment are both due nine months after the period ends.",
  payrollDayOfMonth: "Company practice. UAE law requires wages within 15 days of the period they cover, so most pay between the 25th and the 5th.",
  chequeStaleDays: "Six months is the usual UAE banking practice, not a statute.",
  defaultRetentionPercent: "Five or ten per cent is normal in UAE contracting. Whatever your contract says.",
  expiryWarningDays: "Company preference. Sixty days is enough to renew a visa without rushing.",
  pageSize: "Company preference.",
};

export type FinanceProblem = { key: string; message: string };

const isPercent = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Check the settings before they are saved.
 *
 * Tax rates are not held to a floor the way HR policy is — a rate is whatever
 * the law currently says, and the law can move in either direction, so pinning
 * one would break the system the day it changed. What is checked is that the
 * figure is possible at all: a rate outside nought to one is a percentage typed
 * as a whole number, which would tax a company nine hundred per cent.
 */
export function validateFinancePolicy(p: Partial<FinancePolicy>): FinanceProblem[] {
  const problems: FinanceProblem[] = [];

  for (const [key, label] of [
    ["vatRate", "VAT rate"],
    ["corporateTaxRate", "Corporate tax rate"],
    ["lossReliefCap", "Loss relief cap"],
  ] as const) {
    const v = Number(p[key]);
    if (!isPercent(v)) {
      problems.push({
        key,
        message: `${label} must be between 0 and 1 — 0.05 for five per cent, not 5. ${v > 1 ? "A figure above 1 would charge more than the whole amount." : "It cannot be negative."}`,
      });
    }
  }

  for (const [key, label, max] of [
    ["corporateTaxBand", "Corporate tax band", 100_000_000],
    ["sbrRevenueCap", "Small Business Relief cap", 1_000_000_000],
  ] as const) {
    const v = Number(p[key]);
    if (!Number.isFinite(v) || v < 0 || v > max) {
      problems.push({ key, message: `${label} looks wrong. Check the figure.` });
    }
  }

  const filing = Number(p.filingMonths);
  if (!Number.isFinite(filing) || filing < 1 || filing > 24) {
    problems.push({ key: "filingMonths", message: "The filing deadline is measured in months after the period ends — between 1 and 24." });
  }

  const payDay = Number(p.payrollDayOfMonth);
  if (!Number.isFinite(payDay) || payDay < 1 || payDay > 31 || Math.floor(payDay) !== payDay) {
    problems.push({ key: "payrollDayOfMonth", message: "Payday is a day of the month — a whole number from 1 to 31. A month too short for it pays on its last day." });
  }

  const stale = Number(p.chequeStaleDays);
  if (!Number.isFinite(stale) || stale < 30 || stale > 730) {
    problems.push({ key: "chequeStaleDays", message: "A cheque goes stale somewhere between a month and two years. Six months is usual." });
  }

  const retention = Number(p.defaultRetentionPercent);
  if (!Number.isFinite(retention) || retention < 0 || retention > 50) {
    problems.push({ key: "defaultRetentionPercent", message: "Retention is a percentage of the certificate — normally 5 or 10, never above 50." });
  }

  const expiry = Number(p.expiryWarningDays);
  if (!Number.isFinite(expiry) || expiry < 7 || expiry > 365) {
    problems.push({ key: "expiryWarningDays", message: "Warn between a week and a year ahead. Less than a week is no warning at all." });
  }

  const page = Number(p.pageSize);
  if (!Number.isFinite(page) || page < 10 || page > 500) {
    problems.push({ key: "pageSize", message: "Between 10 and 500 rows a page. More than that and the screen stops being usable." });
  }

  // An account role pointing at nothing means a posting fails at the moment
  // somebody clicks Save on a voucher, which is the worst time to find out.
  const accounts = p.accounts ?? {};
  for (const role of ACCOUNT_ROLES) {
    const code = String((accounts as Record<string, string>)[role.key] ?? "").trim();
    if (!code) {
      problems.push({ key: `accounts.${role.key}`, message: `${role.label} needs an account code.` });
    } else if (!/^[A-Za-z0-9.\-]{1,20}$/.test(code)) {
      problems.push({ key: `accounts.${role.key}`, message: `${role.label}: "${code}" is not a usable account code.` });
    }
  }

  // Two roles on one account is occasionally deliberate but usually a slip, and
  // it makes the retention and VAT reconciliations meaningless.
  const seen = new Map<string, string>();
  for (const role of ACCOUNT_ROLES) {
    const code = String((accounts as Record<string, string>)[role.key] ?? "").trim();
    if (!code) continue;
    const already = seen.get(code);
    if (already) {
      problems.push({
        key: `accounts.${role.key}`,
        message: `${role.label} and ${already} both point at ${code}. The reconciliations compare one against the other, so they cannot share an account.`,
      });
    } else seen.set(code, role.label);
  }

  return problems;
}

/** Fill any gap from the default, so a partial record is usable. */
export function withFinanceDefaults(p?: Partial<FinancePolicy> | null): FinancePolicy {
  const out: FinancePolicy = {
    ...DEFAULT_FINANCE_POLICY,
    accounts: { ...DEFAULT_FINANCE_POLICY.accounts },
  };
  if (!p) return out;

  for (const k of ["vatRate", "corporateTaxRate", "corporateTaxBand", "sbrRevenueCap",
    "lossReliefCap", "filingMonths", "payrollDayOfMonth", "chequeStaleDays", "defaultRetentionPercent",
    "expiryWarningDays", "pageSize"] as const) {
    const v = Number(p[k]);
    if (Number.isFinite(v)) out[k] = v;
  }

  // The eInvoicing identifiers are text, not numbers — Number("") is 0, so the
  // numeric loop above would have quietly turned every one of them into zero.
  for (const k of ["eInvoiceCustomizationId", "eInvoiceProfileId", "eInvoiceProvider"] as const) {
    const v = p[k];
    if (typeof v === "string") out[k] = v.trim();
  }
  const given = (p.accounts ?? {}) as Record<string, string>;
  for (const role of ACCOUNT_ROLES) {
    const code = String(given[role.key] ?? "").trim();
    if (code) out.accounts[role.key] = code;
  }
  return out;
}

/**
 * The account map as stored: a plain object, kept as JSON on the record.
 *
 * A column per role would mean a migration every time a module needs a new
 * posting, which is the sort of friction that makes people reach for a literal
 * code instead.
 */
export function parseAccounts(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Where a company has moved away from the defaults, so the screen can say so. */
export function financeChanges(p: FinancePolicy): string[] {
  const out: string[] = [];
  const d = DEFAULT_FINANCE_POLICY;
  if (p.vatRate !== d.vatRate) out.push(`VAT at ${(p.vatRate * 100).toFixed(2).replace(/\.00$/, "")}%`);
  if (p.corporateTaxRate !== d.corporateTaxRate) out.push(`corporate tax at ${(p.corporateTaxRate * 100).toFixed(2).replace(/\.00$/, "")}%`);
  if (p.corporateTaxBand !== d.corporateTaxBand) out.push(`a nil band of AED ${p.corporateTaxBand.toLocaleString("en-AE")}`);
  if (p.payrollDayOfMonth !== d.payrollDayOfMonth) out.push(`payday on the ${p.payrollDayOfMonth}th`);
  if (p.chequeStaleDays !== d.chequeStaleDays) out.push(`cheques stale at ${p.chequeStaleDays} days`);
  if (p.defaultRetentionPercent !== d.defaultRetentionPercent) out.push(`${p.defaultRetentionPercent}% default retention`);
  if (p.expiryWarningDays !== d.expiryWarningDays) out.push(`${p.expiryWarningDays} days of expiry warning`);
  const moved = ACCOUNT_ROLES.filter((r) => p.accounts[r.key] !== r.code);
  if (moved.length) out.push(`${moved.length} account${moved.length === 1 ? "" : "s"} mapped to your own chart`);
  return out;
}
