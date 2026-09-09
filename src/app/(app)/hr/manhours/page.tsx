import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, HardHat, Timer } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import PeriodPicker from "@/components/PeriodPicker";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { resolvePeriod } from "@/lib/period";
import { summariseManhours, manhoursVerdict, type TimesheetLine, type JobBudget } from "@/lib/manhours";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;

export default async function ManhoursPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAccess("hr.manhours");
  const session = await getSession();
  const sp = await searchParams;
  const companyIds = (session?.companies ?? []).map((c) => c.id);
  const period = resolvePeriod(sp, 1);
  const mayOpenJobs = can(session, "finance.jobs", "view");

  const timesheets = companyIds.length
    ? await db.timesheet.findMany({
        where: { companyId: { in: companyIds }, date: { gte: period.from, lte: period.to } },
        select: {
          jobId: true, employeeId: true, date: true, hours: true, costRate: true, entryId: true,
          job: { select: { code: true, name: true } },
          employee: { select: { empNo: true, name: true, designation: true } },
        },
        orderBy: { date: "asc" },
      })
    : [];

  const lines: TimesheetLine[] = timesheets.map((t) => ({
    jobId: t.jobId,
    jobCode: t.job?.code ?? null,
    jobName: t.job?.name ?? null,
    employeeId: t.employeeId,
    empNo: t.employee?.empNo ?? "—",
    employeeName: t.employee?.name ?? "—",
    trade: t.employee?.designation ?? null,
    date: t.date,
    hours: t.hours,
    costRate: t.costRate,
    // A timesheet with a voucher has been charged to the job. One without has
    // not, and Job Costing's margin is missing it until it is.
    posted: !!t.entryId,
  }));

  const jobRows = companyIds.length
    ? await db.job.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true, code: true, name: true, status: true, budgetHours: true },
      })
    : [];
  const budgets: JobBudget[] = jobRows.map((j) => ({
    jobId: j.id, code: j.code, name: j.name, status: j.status, budgetHours: j.budgetHours,
  }));

  const s = summariseManhours(lines, budgets);
  const v = manhoursVerdict(s);
  const tone = {
    good: "border-brand-green/40 bg-brand-green/10 text-brand-green-700",
    watch: "border-brand-gold/40 bg-brand-gold/10 text-ink",
    bad: "border-red-300 bg-red-50 text-red-700",
  }[v.tone];

  return (
    <div>
      <div className="print-header mb-4 hidden border-b border-line pb-3 print:block">
        <div className="text-lg font-bold text-heading">Manhours</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>

      <PageHeader
        title="HR — Manhours"
        subtitle="Hours on each job against the hours it was priced for, and who is carrying them."
      />

      <HrTabs />

      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      <div className={clsx("mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", tone)}>
        {v.tone === "good" ? <Timer className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
        <p className="font-medium">{v.text}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Hours logged" value={h(s.totals.hours)} />
        <Tile label="Labour cost" value={n(s.totals.cost)} />
        <Tile
          label="Not yet charged to a job"
          value={h(s.totals.unpostedHours)}
          sub={s.totals.unpostedHours > 0 ? "job margins are missing these" : undefined}
          accent={s.totals.unpostedHours > 0 ? "gold" : undefined}
        />
        <Tile
          label="Against no job"
          value={h(s.unallocated.hours)}
          sub={s.unallocated.hours > 0 ? n(s.unallocated.cost) : undefined}
          accent={s.unallocated.hours > 0 ? "gold" : undefined}
        />
      </div>

      <div className="card mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">By job</h2>
          <span className="text-xs text-muted">most hours first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Job</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">People</th>
                <th className="px-4 py-2.5 text-right font-semibold">Hours</th>
                <th className="px-4 py-2.5 text-right font-semibold">Budget</th>
                <th className="px-4 py-2.5 text-right font-semibold">Used</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.jobs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No hours logged against a job in this period.</td></tr>
              )}
              {s.jobs.map((j) => (
                <tr key={j.jobId} className={clsx("hover:bg-brand-paper/60", j.budgetHours > 0 && j.used > 1 && "bg-red-50/60")}>
                  <td className="px-4 py-2.5">
                    {mayOpenJobs ? (
                      <Link href={`/finance/jobs`} className="text-brand-blue-600 hover:underline">
                        <span className="text-xs text-muted">{j.code}</span> {j.name}
                      </Link>
                    ) : (
                      <><span className="text-xs text-muted">{j.code}</span> <span className="text-ink">{j.name}</span></>
                    )}
                    {j.unpostedHours > 0 && (
                      <span className="ml-2 rounded bg-brand-gold/15 px-1.5 py-0.5 text-[11px] text-brand-gold">
                        {h(j.unpostedHours)} not charged
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{j.status}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{j.people}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-heading">{h(j.hours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {j.budgetHours > 0 ? h(j.budgetHours) : <span className="text-muted/60">not set</span>}
                  </td>
                  <td className={clsx(
                    "px-4 py-2.5 text-right tabular-nums",
                    j.budgetHours === 0 ? "text-muted/60"
                      : j.used > 1 ? "font-medium text-red-600"
                      : j.used >= 0.9 ? "font-medium text-brand-gold" : "text-ink",
                  )}>
                    {j.budgetHours > 0 ? `${Math.round(j.used * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-heading">{n(j.cost)}</td>
                </tr>
              ))}
              {s.unallocated.hours > 0 && (
                <tr className="bg-brand-gold/5">
                  <td className="px-4 py-2.5 text-ink">
                    <span className="text-xs text-muted">—</span> Not booked to any job
                  </td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-brand-gold">{h(s.unallocated.hours)}</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right tabular-nums text-brand-gold">{n(s.unallocated.cost)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">By person</h2>
          <span className="text-xs text-muted">most hours first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                <th className="px-4 py-2.5 font-semibold">Trade</th>
                <th className="px-4 py-2.5 text-right font-semibold">Jobs</th>
                <th className="px-4 py-2.5 text-right font-semibold">Hours</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.people.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Nobody has logged time in this period.</td></tr>
              )}
              {s.people.map((p) => (
                <tr key={p.employeeId} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="text-xs text-muted">{p.empNo}</span> <span className="text-ink">{p.employeeName}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted">{p.trade}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{p.jobs}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-heading">{h(p.hours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-heading">{n(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <HardHat className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">What this reads:</span> the timesheets logged on HR
          → Time → Attendance, priced at the cost rate captured when each entry was made, so a later
          pay rise does not rewrite last year&rsquo;s cost. Budgeted hours are set on the job itself
          (Finance → Job Costing); a job with none shows &ldquo;not set&rdquo; rather than a
          misleading nought per cent. Hours marked &ldquo;not charged&rdquo; are real work that has
          not reached the ledger yet, so the margin on Job Costing is still missing them.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "gold" }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx("mt-1 text-2xl font-bold tabular-nums", accent === "gold" ? "text-brand-gold" : "text-heading")}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
