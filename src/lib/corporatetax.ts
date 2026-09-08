/**
 * UAE Corporate Tax.
 *
 * Federal Decree-Law 47 of 2022 brought corporate tax to the UAE for financial
 * years beginning on or after 1 June 2023. Nine per cent, with the first
 * AED 375,000 of taxable income at nil, and one return a year filed through
 * EmaraTax within nine months of the period end. There are no instalments and
 * no provisional return: one filing, one payment, same deadline.
 *
 * What this module is, and is not
 * -------------------------------
 * It is not a filing. Nothing here talks to the FTA — the return is typed into
 * EmaraTax by a person, and it always will be. What it is, is the working paper
 * behind the numbers that person types: accounting profit taken straight from
 * the ledger for the period, the adjustments listed beside it with a reason
 * each, and the arithmetic laid out in the FTA's own order so the taxable
 * income can be traced back to the books that produced it.
 *
 * That is the part firms usually keep in a spreadsheet nobody can find two
 * years later, when the FTA asks why entertainment was halved.
 *
 * Per company, deliberately
 * -------------------------
 * Corporate tax is charged on a taxable person, and each company in a group is
 * its own taxable person unless a tax group has been formed — a formal election
 * with its own conditions, not the default. So WBE, WBTS and VTS each file
 * separately, each with its own registration number and its own AED 375,000
 * band. A group-wide total would be the wrong number in every direction.
 *
 * Not server-only: the screen previews the computation as adjustments are
 * typed, before anything is saved.
 */

import { periodMovement, type AccountBalances } from "./ledger";

/** Nine per cent, on taxable income above the band. */
export const CT_RATE = 0.09;

/**
 * The first slice of taxable income is taxed at nil.
 *
 * It is a band, not a cliff: going over it does not make the whole amount
 * taxable, only the excess. Getting that wrong overstates the tax on a small
 * profit by about thirty-four thousand dirhams.
 */
export const CT_BAND = 375_000;

/** Revenue at or below this may elect Small Business Relief. */
export const SBR_REVENUE_CAP = 3_000_000;

/**
 * The last tax period for which Small Business Relief can be claimed.
 *
 * Originally legislated to 31 December 2026 and since extended by Ministerial
 * Decision to 31 December 2029. Held as a date rather than buried in a rule,
 * because it has moved once and may move again — and when it does, this is the
 * one line to change.
 */
export const SBR_AVAILABLE_UNTIL = new Date(Date.UTC(2029, 11, 31));

/** Tax losses relieve at most this share of taxable income in any one period. */
export const LOSS_RELIEF_CAP = 0.75;

/** The return and the payment are both due this long after the period ends. */
export const FILING_MONTHS = 9;

/** Late filing: AED 500 a month for the first year, AED 1,000 a month after. */
export const LATE_PENALTY_FIRST_YEAR = 500;
export const LATE_PENALTY_THEREAFTER = 1_000;

export const CT_STATUSES = ["Draft", "Filed"] as const;
export type CtStatus = (typeof CT_STATUSES)[number];

export const STATUS_HELP: Record<string, string> = {
  Draft: "Still being worked on. Change it as often as you like — nothing has been submitted.",
  Filed: "Submitted to the FTA through EmaraTax. Keep it as the record of what was sent.",
};

/* ------------------------------------------------------------- adjustments */

export const ADJUSTMENT_KINDS = ["Add back", "Deduct", "Exempt income"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const KIND_HELP: Record<string, string> = {
  "Add back":
    "Something the accounts treated as a cost but the tax law will not allow. It increases taxable income.",
  Deduct:
    "Something the tax law allows that the accounts have not taken. It reduces taxable income.",
  "Exempt income":
    "Income the accounts include but corporate tax does not charge — a dividend from a UAE company, for example. It reduces taxable income.",
};

/**
 * The adjustments a UAE contracting company actually meets.
 *
 * Each carries its reason in plain words, because the person filling this in is
 * usually an accountant rather than a tax adviser, and "50% of entertainment"
 * is not self-explanatory the first time you meet it.
 */
export const ADJUSTMENT_CATEGORIES = [
  {
    key: "Fines and penalties",
    kind: "Add back" as AdjustmentKind,
    help: "Fines and administrative penalties are never deductible. Add back the whole amount.",
    example: "AED 3,000 of municipality fines — add back 3,000.",
  },
  {
    key: "Entertainment (50%)",
    kind: "Add back" as AdjustmentKind,
    help: "Only half of client entertainment is deductible. Add back the other half.",
    example: "AED 20,000 spent entertaining clients — add back 10,000.",
  },
  {
    key: "Donations to non-approved bodies",
    kind: "Add back" as AdjustmentKind,
    help: "Only donations to bodies on the Cabinet's approved list are deductible. Everything else is added back.",
    example: "AED 5,000 to an unlisted charity — add back 5,000.",
  },
  {
    key: "Owner's personal expenses",
    kind: "Add back" as AdjustmentKind,
    help: "Spending that was not wholly for the business — personal travel, a family car — is added back.",
    example: "AED 12,000 of personal travel put through the company — add back 12,000.",
  },
  {
    key: "Interest above the limit",
    kind: "Add back" as AdjustmentKind,
    help: "Net interest above the general interest deduction limitation is added back. It carries forward for up to ten years.",
    example: "Interest disallowed this year — add it back, and note it for next year.",
  },
  {
    key: "Depreciation adjustment",
    kind: "Add back" as AdjustmentKind,
    help: "Where tax treats an asset differently from the accounts, the difference is adjusted here.",
    example: "Accounts charged 100,000, tax allows 80,000 — add back 20,000.",
  },
  {
    key: "Provisions not yet incurred",
    kind: "Add back" as AdjustmentKind,
    help: "A general provision for something that has not happened yet is not deductible until it does.",
    example: "A general bad-debt provision of AED 40,000 — add back 40,000.",
  },
  {
    key: "Dividends from UAE companies",
    kind: "Exempt income" as AdjustmentKind,
    help: "A dividend from a UAE resident company is exempt. Take it out.",
    example: "AED 100,000 dividend from a UAE subsidiary — deduct 100,000.",
  },
  {
    key: "Foreign branch profit exempted",
    kind: "Exempt income" as AdjustmentKind,
    help: "Where the company has elected to exempt a foreign permanent establishment, its profit comes out here.",
    example: "The profit of an exempted overseas branch — deduct it.",
  },
  {
    key: "Other allowable deduction",
    kind: "Deduct" as AdjustmentKind,
    help: "Anything the tax law allows that the accounts have not already taken.",
    example: "A tax-allowable cost that was never booked.",
  },
  {
    key: "Other",
    kind: "Add back" as AdjustmentKind,
    help: "Anything else. Write what it is in the note, so the next person knows.",
    example: "",
  },
] as const;

export const CATEGORY_KEYS: string[] = ADJUSTMENT_CATEGORIES.map((c) => c.key);

export const categoryHelp = (key: string): string =>
  ADJUSTMENT_CATEGORIES.find((c) => c.key === key)?.help ?? "";

/** The kind a category normally takes, so the form fills itself in. */
export const categoryKind = (key: string): AdjustmentKind =>
  ADJUSTMENT_CATEGORIES.find((c) => c.key === key)?.kind ?? "Add back";

/* --------------------------------------------------------------- the sums */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type AdjustmentLike = {
  kind: string;
  amount: number;
};

export type ComputationInput = {
  /** Income less expenses for the period, taken from the ledger. */
  accountingProfit: number;
  /**
   * Gross income for the period. This, not profit, is what the Small Business
   * Relief threshold is measured against — a company can turn over five million
   * and make nothing, and it still cannot claim.
   */
  revenue: number;
  adjustments: AdjustmentLike[];
  /** Unrelieved losses brought in from earlier periods. */
  lossesBroughtForward?: number;
  sbrElected?: boolean;
  /** The end of the tax period, which decides whether relief is still open. */
  periodTo?: Date;
};

export type Computation = {
  accountingProfit: number;
  revenue: number;
  addBacks: number;
  deductions: number;
  exemptIncome: number;
  /** Taxable income before any loss is set against it. */
  adjustedProfit: number;
  lossesBroughtForward: number;
  /** The most that may be relieved this period — 75% of adjusted profit. */
  lossReliefCap: number;
  lossRelief: number;
  lossesCarriedForward: number;
  taxableIncome: number;
  /** The slice charged at nil. */
  bandUsed: number;
  /** The slice charged at 9%. */
  chargeable: number;
  taxPayable: number;
  /** Small Business Relief: whether it may be claimed, and whether it was. */
  sbrEligible: boolean;
  sbrElected: boolean;
  sbrApplied: boolean;
  sbrReason: string;
  /**
   * What the tax would have been without the relief. Worth showing, so the
   * election is a decision somebody made rather than a box that was ticked.
   */
  taxWithoutSbr: number;
};

/**
 * Whether Small Business Relief is open to this company for this period.
 *
 * Two conditions are testable here: revenue at or under AED 3,000,000, and a
 * period ending on or before the date the relief runs out. The others — being a
 * Qualifying Free Zone Person, or a member of a multinational group above
 * AED 3.15 billion — are facts about the company that the system does not hold,
 * so the screen states them plainly rather than pretending to check them.
 */
export function sbrEligibility(revenue: number, periodTo?: Date) {
  if (round2(revenue) > SBR_REVENUE_CAP) {
    return {
      eligible: false,
      reason: `Revenue is above the AED ${SBR_REVENUE_CAP.toLocaleString("en-AE")} limit, so Small Business Relief cannot be claimed for this period.`,
    };
  }
  if (periodTo && periodTo.getTime() > SBR_AVAILABLE_UNTIL.getTime()) {
    return {
      eligible: false,
      reason:
        "Small Business Relief is not available for tax periods ending after 31 December 2029.",
    };
  }
  return {
    eligible: true,
    reason: `Revenue is at or under AED ${SBR_REVENUE_CAP.toLocaleString("en-AE")}, so this period may elect Small Business Relief and be treated as having no taxable income.`,
  };
}

/**
 * Accounting profit to tax payable, in the order the FTA return asks for it.
 *
 * The sequence matters and is not obvious: adjustments first, then losses
 * against the adjusted figure and capped at 75% of it, then the band, then the
 * rate. Applying the band before the losses, or the losses before the
 * adjustments, gives a different — and wrong — answer.
 */
export function compute(input: ComputationInput): Computation {
  const accountingProfit = round2(input.accountingProfit);
  const revenue = round2(input.revenue);

  let addBacks = 0;
  let deductions = 0;
  let exemptIncome = 0;
  for (const a of input.adjustments ?? []) {
    const amount = round2(a.amount);
    if (a.kind === "Add back") addBacks += amount;
    else if (a.kind === "Deduct") deductions += amount;
    else if (a.kind === "Exempt income") exemptIncome += amount;
  }
  addBacks = round2(addBacks);
  deductions = round2(deductions);
  exemptIncome = round2(exemptIncome);

  const adjustedProfit = round2(accountingProfit + addBacks - deductions - exemptIncome);

  // Losses only relieve a profit, and only three quarters of one.
  const lossesBroughtForward = Math.max(0, round2(input.lossesBroughtForward ?? 0));
  const lossReliefCap = adjustedProfit > 0 ? round2(adjustedProfit * LOSS_RELIEF_CAP) : 0;
  const lossRelief = round2(Math.min(lossesBroughtForward, lossReliefCap));

  const taxableIncome = round2(adjustedProfit - lossRelief);

  // A loss made this period joins the pool; unrelieved brought-forward losses
  // stay in it. Losses carry forward indefinitely, so nothing is dropped here.
  const lossThisPeriod = adjustedProfit < 0 ? -adjustedProfit : 0;
  const lossesCarriedForward = round2(lossesBroughtForward - lossRelief + lossThisPeriod);

  const positive = Math.max(0, taxableIncome);
  const bandUsed = round2(Math.min(positive, CT_BAND));
  const chargeable = round2(Math.max(0, positive - CT_BAND));
  const taxWithoutSbr = round2(chargeable * CT_RATE);

  const { eligible, reason } = sbrEligibility(revenue, input.periodTo);
  const sbrElected = Boolean(input.sbrElected);
  const sbrApplied = sbrElected && eligible;

  return {
    accountingProfit,
    revenue,
    addBacks,
    deductions,
    exemptIncome,
    adjustedProfit,
    lossesBroughtForward,
    lossReliefCap,
    lossRelief,
    lossesCarriedForward,
    taxableIncome,
    bandUsed,
    chargeable,
    taxPayable: sbrApplied ? 0 : taxWithoutSbr,
    sbrEligible: eligible,
    sbrElected,
    sbrApplied,
    sbrReason: reason,
    taxWithoutSbr,
  };
}

/* --------------------------------------------------------------- the clock */

/**
 * The filing deadline: nine months after the period ends.
 *
 * Adding nine months to a date is not as simple as it sounds, and the FTA's own
 * worked examples show why. A year ending 31 December 2024 is due by
 * 30 September 2025 — a shorter day-of-month, because September has thirty
 * days. But a year ending 30 June 2024 is due by 31 March 2025, not 30 March:
 * the deadline is the end of March, not the thirtieth of it.
 *
 * So the rule a tax period actually follows is month-end to month-end. A period
 * that ends on the last day of its month is due on the last day of the month
 * nine later; that covers every financial year, which is all a tax period
 * normally is. A period ending mid-month — a first short period, or a
 * liquidation — takes the same day nine months on, clamped so 31 May does not
 * become the 31st of a February that has no such day.
 */
export function dueDate(periodTo: Date): Date {
  const y = periodTo.getUTCFullYear();
  const m = periodTo.getUTCMonth();
  const d = periodTo.getUTCDate();

  const lastOfOwn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lastOfTarget = new Date(Date.UTC(y, m + FILING_MONTHS + 1, 0)).getUTCDate();

  // A month-end goes to a month-end; anything else keeps its day, clamped.
  const day = d === lastOfOwn ? lastOfTarget : Math.min(d, lastOfTarget);
  return new Date(Date.UTC(y, m + FILING_MONTHS, day));
}

/**
 * Whole months from one date to another, counting any part of a month as one.
 *
 * The FTA charges its penalty "per month, or part thereof", so a day late costs
 * the same as four weeks late. Counting in calendar months rather than
 * thirty-day blocks matters once a return is more than a year overdue: thirteen
 * calendar months is 395 days, which a thirty-day count reads as fourteen and
 * overstates the penalty by a thousand dirhams.
 */
function monthsBetween(from: Date, to: Date): number {
  const whole =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() === from.getUTCDate()) return whole;
  // Short of the anniversary day: one fewer whole month, plus the part month.
  return (to.getUTCDate() < from.getUTCDate() ? whole - 1 : whole) + 1;
}

/**
 * How the deadline reads today, and what being late would cost.
 *
 * The figure is the late-filing penalty alone: AED 500 for each of the first
 * twelve months and AED 1,000 a month after that. Late payment carries its own
 * separate charge that depends on the tax due, and is not guessed at here.
 */
export function filingState(periodTo: Date, status: string, asAt: Date) {
  const due = dueDate(periodTo);
  const days = Math.floor((due.getTime() - asAt.getTime()) / 86_400_000);
  const filed = status === "Filed";
  const overdue = !filed && days < 0;

  const monthsLate = overdue ? Math.max(1, monthsBetween(due, asAt)) : 0;
  const first = Math.min(monthsLate, 12);
  const rest = Math.max(0, monthsLate - 12);

  return {
    due,
    daysRemaining: days,
    filed,
    overdue,
    dueSoon: !filed && days >= 0 && days <= 60,
    monthsLate,
    estimatedPenalty: overdue
      ? first * LATE_PENALTY_FIRST_YEAR + rest * LATE_PENALTY_THEREAFTER
      : 0,
  };
}

/**
 * The tax period a company's financial year gives.
 *
 * The tax period is the financial year, so a company whose year starts in July
 * has a period of 1 July to 30 June — and a deadline that moves with it.
 * `endingIn` is the calendar year the period ends in, which is how everyone
 * refers to it: "the 2025 return".
 */
export function financialYear(fyStartMonth: number, endingIn: number) {
  const m = Math.min(12, Math.max(1, Math.round(Number(fyStartMonth) || 1)));
  // A January year starts and ends in the same calendar year; any other start
  // begins in the year before the one it ends in.
  const startYear = m === 1 ? endingIn : endingIn - 1;
  return {
    from: new Date(Date.UTC(startYear, m - 1, 1)),
    // Day 0 of the start month, one year on: the last day before it comes round.
    to: new Date(Date.UTC(startYear + 1, m - 1, 0)),
  };
}

/* ------------------------------------------------------ from the ledger -- */

/**
 * Accounting profit and revenue for a period, read straight from the books.
 *
 * The one figure nobody should retype. Every screen that needs it — the
 * computation, the export, and the carry-forward when a new period is opened —
 * comes through here, so all three agree by construction rather than by three
 * people writing the same loop.
 *
 * Revenue is gross income, not profit: it is what the Small Business Relief
 * threshold is measured against, and a company can turn over five million while
 * making nothing.
 */
export function profitFrom(
  accounts: (AccountBalances & { type: string })[],
  from: Date,
  to: Date,
  openingAsOf?: Date | null
): { income: number; expense: number; accountingProfit: number } {
  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    const net = periodMovement(a, from, to, openingAsOf);
    // Income carries a credit balance, so its movement comes back negative.
    if (a.type === "Income") income += -net;
    else if (a.type === "Expense") expense += net;
  }
  return {
    income: round2(income),
    expense: round2(expense),
    accountingProfit: round2(income - expense),
  };
}
