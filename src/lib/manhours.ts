/**
 * Manhours — where the labour actually went.
 *
 * Job Costing turns hours into money and reports the margin. That is the
 * finance question. The operations question is the one underneath it: how many
 * hours has this job eaten, against how many it was priced for, and who is on
 * it. A margin tells you the job went wrong; hours against budget tell you
 * while it still can be put right.
 *
 * Pure arithmetic, no database.
 */

const round = (n: number) => Math.round(n * 100) / 100;

export type TimesheetLine = {
  jobId: string | null;
  jobCode?: string | null;
  jobName?: string | null;
  employeeId: string;
  empNo: string;
  employeeName: string;
  trade?: string | null;
  date: Date;
  hours: number;
  /** Cost per hour at the time it was recorded. */
  costRate: number;
  /** True once the hours have been charged to the job in the ledger. */
  posted: boolean;
};

export type JobBudget = {
  jobId: string;
  code: string;
  name: string;
  status: string;
  budgetHours: number;
};

export type JobManhours = {
  jobId: string;
  code: string;
  name: string;
  status: string;
  hours: number;
  cost: number;
  budgetHours: number;
  /** Hours used as a share of budget. 0 when no budget was set. */
  used: number;
  remaining: number;
  /** Hours logged but not yet charged to the job — the margin is missing them. */
  unpostedHours: number;
  people: number;
};

export type ManhoursSummary = {
  jobs: JobManhours[];
  /** Time recorded against no job at all. */
  unallocated: { hours: number; cost: number };
  totals: { hours: number; cost: number; budgetHours: number; unpostedHours: number };
  /** Jobs past their budgeted hours, worst first. */
  overBudget: JobManhours[];
  /** Hours by person, for "who is carrying this". */
  people: { employeeId: string; empNo: string; employeeName: string; trade: string; hours: number; cost: number; jobs: number }[];
};

/**
 * A job is "over" once it has used more than this share of its budget hours.
 * Reported before it is spent, not after, because after is too late to act.
 */
export const BUDGET_WARNING_SHARE = 0.9;

export function summariseManhours(lines: TimesheetLine[], budgets: JobBudget[]): ManhoursSummary {
  const byJob = new Map<string, JobManhours & { staff: Set<string> }>();
  const byPerson = new Map<string, { employeeId: string; empNo: string; employeeName: string; trade: string; hours: number; cost: number; jobs: Set<string> }>();
  const unallocated = { hours: 0, cost: 0 };

  const budgetFor = new Map(budgets.map((b) => [b.jobId, b]));

  for (const l of lines) {
    const cost = round(l.hours * l.costRate);

    const person = byPerson.get(l.employeeId) ?? {
      employeeId: l.employeeId, empNo: l.empNo, employeeName: l.employeeName,
      trade: l.trade || "—", hours: 0, cost: 0, jobs: new Set<string>(),
    };
    person.hours = round(person.hours + l.hours);
    person.cost = round(person.cost + cost);
    if (l.jobId) person.jobs.add(l.jobId);
    byPerson.set(l.employeeId, person);

    // Hours logged against no job are the ones that quietly disappear from
    // every job report, so they are counted and shown rather than dropped.
    if (!l.jobId) {
      unallocated.hours = round(unallocated.hours + l.hours);
      unallocated.cost = round(unallocated.cost + cost);
      continue;
    }

    const b = budgetFor.get(l.jobId);
    const job = byJob.get(l.jobId) ?? {
      jobId: l.jobId,
      code: b?.code ?? l.jobCode ?? "—",
      name: b?.name ?? l.jobName ?? "—",
      status: b?.status ?? "Open",
      hours: 0, cost: 0,
      budgetHours: b?.budgetHours ?? 0,
      used: 0, remaining: 0, unpostedHours: 0, people: 0,
      staff: new Set<string>(),
    };
    job.hours = round(job.hours + l.hours);
    job.cost = round(job.cost + cost);
    if (!l.posted) job.unpostedHours = round(job.unpostedHours + l.hours);
    job.staff.add(l.employeeId);
    byJob.set(l.jobId, job);
  }

  const jobs: JobManhours[] = [...byJob.values()]
    .map(({ staff, ...j }) => ({
      ...j,
      people: staff.size,
      used: j.budgetHours > 0 ? round(j.hours / j.budgetHours) : 0,
      remaining: j.budgetHours > 0 ? round(j.budgetHours - j.hours) : 0,
    }))
    .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code));

  const totals = jobs.reduce(
    (t, j) => ({
      hours: round(t.hours + j.hours),
      cost: round(t.cost + j.cost),
      budgetHours: round(t.budgetHours + j.budgetHours),
      unpostedHours: round(t.unpostedHours + j.unpostedHours),
    }),
    { hours: 0, cost: 0, budgetHours: 0, unpostedHours: 0 },
  );
  totals.hours = round(totals.hours + unallocated.hours);
  totals.cost = round(totals.cost + unallocated.cost);

  return {
    jobs,
    unallocated,
    totals,
    // Only jobs that actually have a budget can be over it. A job with no
    // budget is not "0% used" and must not be reported as breaching one.
    overBudget: jobs.filter((j) => j.budgetHours > 0 && j.used >= BUDGET_WARNING_SHARE)
      .sort((a, b) => b.used - a.used),
    people: [...byPerson.values()]
      .map(({ jobs: set, ...p }) => ({ ...p, jobs: set.size }))
      .sort((a, b) => b.hours - a.hours || a.employeeName.localeCompare(b.employeeName)),
  };
}

/** One sentence for the top of the screen. */
export function manhoursVerdict(s: ManhoursSummary): { tone: "good" | "watch" | "bad"; text: string } {
  const hours = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
  const blown = s.overBudget.filter((j) => j.used > 1);
  if (blown.length > 0) {
    return {
      tone: "bad",
      text: `${blown.length} ${blown.length === 1 ? "job has" : "jobs have"} used more hours than they were priced for — ${blown[0].code} is at ${Math.round(blown[0].used * 100)}%.`,
    };
  }
  if (s.overBudget.length > 0) {
    return {
      tone: "watch",
      text: `${s.overBudget.length} ${s.overBudget.length === 1 ? "job is" : "jobs are"} within ten per cent of their budgeted hours.`,
    };
  }
  if (s.unallocated.hours > 0 && s.totals.hours > 0 && s.unallocated.hours / s.totals.hours > 0.1) {
    return {
      tone: "watch",
      text: `${hours(s.unallocated.hours)} were recorded against no job at all — that time is missing from every job's cost.`,
    };
  }
  return { tone: "good", text: "Every job is inside its budgeted hours." };
}
