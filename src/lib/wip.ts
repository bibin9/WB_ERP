/**
 * Work in progress, and where each contract actually stands.
 *
 * Job Costing answers "what did this job earn and cost". That is a period
 * question and it is not the same as "how is this contract doing", which is a
 * life-to-date question and the one a contractor is asked in every review.
 *
 * The gap between billing and earning
 * -----------------------------------
 * On a long contract, what you have invoiced and what you have earned are two
 * different numbers and they are almost never equal. Bill ahead of the work and
 * the surplus is not yours yet — it is a liability, money held against work
 * still to do. Bill behind the work and you are carrying an asset nobody has
 * asked the client for. Both are invisible in a profit and loss that simply
 * totals what was invoiced, and both are exactly what a year-end audit asks
 * about first.
 *
 * How complete a contract is
 * --------------------------
 * Measured by cost: what has been spent against what it was expected to cost.
 * It is the standard method, it uses figures already in the ledger, and it does
 * not depend on somebody's opinion of how far along site looks. Two things it
 * must not do, and both are handled below: guess when no budget was ever set,
 * and report more than complete because a job overspent.
 *
 * Contracts that will lose money
 * ------------------------------
 * When the expected total cost passes the contract value, the whole loss is
 * taken now, not spread over the remaining months. That is the rule, and it is
 * also the only humane way to run a business: a loss you recognise in month
 * three is a decision you can still act on, and one you defer to month eleven
 * is an explanation.
 *
 * Not server-only: the screen totals and sorts with this.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Statuses that mean the work is over, whatever the cost ratio says. */
export const FINISHED_STATUSES = new Set(["Completed", "Closed"]);

export type ContractInput = {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Rolled up over sub-jobs, so a main contract includes its variations. */
  contractValue: number;
  budgetCost: number;
  /** Life to date, not for a period. */
  costToDate: number;
  billedToDate: number;
};

export type ContractPosition = "Over-billed" | "Under-billed" | "In line" | "Not measurable";

/**
 * How far through a contract is, by cost.
 *
 * Returns null rather than a number when there is no budget to measure
 * against. A contract with no budget is not nought per cent complete — it is
 * unmeasured, and showing it as nought would put a live job at the top of every
 * "barely started" list and quietly wreck the totals underneath.
 *
 * Capped at one. A job that has overspent is not more than finished; the
 * overspend belongs in the margin, which is where it is reported. Anything
 * marked Completed or Closed is complete by definition, however the costs
 * landed — otherwise a job delivered under budget reads as unfinished forever.
 */
export function percentComplete(c: Pick<ContractInput, "costToDate" | "budgetCost" | "status">): number | null {
  if (FINISHED_STATUSES.has(c.status)) return 1;
  const budget = Number(c.budgetCost) || 0;
  if (budget <= 0) return null;
  const spent = Number(c.costToDate) || 0;
  if (spent <= 0) return 0;
  return Math.min(1, spent / budget);
}

export type ContractState = {
  percentComplete: number | null;
  /** Contract value earned so far. Null when completeness cannot be measured. */
  revenueEarned: number | null;
  /** What is left in the budget. Never negative; an overspend shows in margin. */
  costToComplete: number | null;
  /** Contract value less expected total cost, at today's estimate. */
  forecastMargin: number | null;
  forecastMarginShare: number | null;
  /** Billed beyond what has been earned — a liability, not income yet. */
  overBilled: number;
  /** Earned but not yet billed — an asset the client has not been asked for. */
  underBilled: number;
  position: ContractPosition;
  /** Expected total cost exceeds the contract value. */
  onerous: boolean;
  /** The whole expected loss, recognised now rather than spread. */
  expectedLoss: number;
  /** Already spent more than the job was priced to cost. */
  overspent: boolean;
};

/**
 * Where one contract stands.
 *
 * Every figure that depends on completeness is null when completeness is
 * unknown, so a missing budget can never be mistaken for a contract that is
 * exactly on plan.
 */
export function contractState(c: ContractInput): ContractState {
  const value = Number(c.contractValue) || 0;
  const budget = Number(c.budgetCost) || 0;
  const spent = Number(c.costToDate) || 0;
  const billed = Number(c.billedToDate) || 0;

  const pct = percentComplete(c);
  const earned = pct === null ? null : round2(value * pct);

  // Expected total cost is the budget, or what has already been spent when
  // that is more — a budget already exceeded is no longer an estimate.
  const expectedCost = Math.max(budget, spent);
  const forecastMargin = budget > 0 || spent > 0 ? round2(value - expectedCost) : null;

  const onerous = (budget > 0 || spent > 0) && expectedCost > value && value > 0;

  let over = 0;
  let under = 0;
  let position: ContractPosition = "Not measurable";
  if (earned !== null) {
    const diff = round2(billed - earned);
    if (diff > 0) {
      over = diff;
      position = "Over-billed";
    } else if (diff < 0) {
      under = -diff;
      position = "Under-billed";
    } else {
      position = "In line";
    }
  }

  return {
    percentComplete: pct,
    revenueEarned: earned,
    costToComplete: budget > 0 ? round2(Math.max(0, budget - spent)) : null,
    forecastMargin,
    forecastMarginShare: forecastMargin !== null && value > 0 ? forecastMargin / value : null,
    overBilled: over,
    underBilled: under,
    position,
    onerous,
    expectedLoss: onerous ? round2(expectedCost - value) : 0,
    overspent: budget > 0 && spent > budget,
  };
}

export type WipTotals = {
  contracts: number;
  measurable: number;
  contractValue: number;
  costToDate: number;
  billedToDate: number;
  revenueEarned: number;
  /** Sum of under-billing — due from customers for work already done. */
  contractAssets: number;
  /** Sum of over-billing — due to customers for work not yet done. */
  contractLiabilities: number;
  /** Contracts expected to finish at a loss, and the total to provide for. */
  onerousCount: number;
  expectedLosses: number;
  /** Contracts with no budget, so nothing about them can be measured. */
  unbudgeted: number;
};

/**
 * The register in one set of figures.
 *
 * Assets and liabilities are kept apart rather than netted. One contract
 * under-billed by a million and another over-billed by a million is not the
 * same business as two contracts sitting exactly on plan, and a single net
 * figure says it is.
 */
export function summariseWip(rows: ContractInput[]): WipTotals {
  const t: WipTotals = {
    contracts: 0,
    measurable: 0,
    contractValue: 0,
    costToDate: 0,
    billedToDate: 0,
    revenueEarned: 0,
    contractAssets: 0,
    contractLiabilities: 0,
    onerousCount: 0,
    expectedLosses: 0,
    unbudgeted: 0,
  };

  for (const c of rows) {
    const s = contractState(c);
    t.contracts += 1;
    t.contractValue += Number(c.contractValue) || 0;
    t.costToDate += Number(c.costToDate) || 0;
    t.billedToDate += Number(c.billedToDate) || 0;

    if (s.percentComplete === null) t.unbudgeted += 1;
    else {
      t.measurable += 1;
      t.revenueEarned += s.revenueEarned ?? 0;
      t.contractAssets += s.underBilled;
      t.contractLiabilities += s.overBilled;
    }
    if (s.onerous) {
      t.onerousCount += 1;
      t.expectedLosses += s.expectedLoss;
    }
  }

  for (const k of [
    "contractValue", "costToDate", "billedToDate", "revenueEarned",
    "contractAssets", "contractLiabilities", "expectedLosses",
  ] as const) {
    t[k] = round2(t[k]);
  }
  return t;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The sentence at the top.
 *
 * A contract heading for a loss outranks everything else, because it is the
 * only thing on this screen that somebody can still do something about.
 */
export function wipVerdict(rows: ContractInput[]): string {
  if (!rows.length) return "No contracts to report on. Add a job with a contract value and a budget to see where it stands.";

  const t = summariseWip(rows);

  if (t.onerousCount > 0) {
    const which = t.onerousCount === 1 ? "One contract is" : `${t.onerousCount} contracts are`;
    return `${which} expected to finish at a loss, totalling ${fmt(t.expectedLosses)}. The whole loss belongs in this period, not spread over the months left.`;
  }
  if (t.measurable === 0) {
    return `None of the ${t.contracts} contracts has a budget, so how far through they are cannot be measured. Set a budget cost on each job.`;
  }
  if (t.contractLiabilities > 0 && t.contractAssets > 0) {
    return `Billed ${fmt(t.contractLiabilities)} ahead of the work on some contracts, and ${fmt(t.contractAssets)} behind it on others.`;
  }
  if (t.contractLiabilities > 0) {
    return `Billed ${fmt(t.contractLiabilities)} ahead of the work done. That is money held against work still owed, not profit.`;
  }
  if (t.contractAssets > 0) {
    return `${fmt(t.contractAssets)} of work has been done and not yet billed. It is earned, and nobody has asked the client for it.`;
  }
  return "Billing is in line with the work done on every measurable contract.";
}

/**
 * Worst first.
 *
 * A loss-making contract leads, then the largest over-billing, because that is
 * the money most likely to be mistaken for profit. Unmeasurable contracts sink
 * to the bottom rather than being dropped — they still need a budget.
 */
export function rankContracts<T extends ContractInput>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = contractState(a);
    const sb = contractState(b);
    if (sa.onerous !== sb.onerous) return sa.onerous ? -1 : 1;
    if (sa.onerous && sb.onerous) return sb.expectedLoss - sa.expectedLoss;
    const ua = sa.percentComplete === null;
    const ub = sb.percentComplete === null;
    if (ua !== ub) return ua ? 1 : -1;
    const ea = Math.max(sa.overBilled, sa.underBilled);
    const eb = Math.max(sb.overBilled, sb.underBilled);
    if (eb !== ea) return eb - ea;
    return a.code.localeCompare(b.code);
  });
}
