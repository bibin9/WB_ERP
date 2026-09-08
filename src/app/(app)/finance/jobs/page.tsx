import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PeriodPicker from "@/components/PeriodPicker";
import PrintReport from "@/components/finance/PrintReport";
import ExportButton from "@/components/ExportButton";
import GuardedDelete from "@/components/GuardedDelete";
import JobForm from "@/components/finance/JobForm";
import PostLabour from "@/components/finance/PostLabour";
import { lineCost } from "@/lib/labour";
import { deleteJob } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { arrange, withDescendants } from "@/lib/tree";
import { money } from "@/lib/money";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const statusColor: Record<string, string> = {
  Open: "bg-brand-green/10 text-brand-green-700",
  "On hold": "bg-brand-gold/10 text-brand-gold",
  Completed: "bg-brand-blue/10 text-brand-blue-600",
  Closed: "bg-line text-muted",
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; from?: string; to?: string }>;
}) {
  await requireAccess("finance.jobs");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);

  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId },
        include: {
          party: { select: { name: true } },
          lines: {
            where: { entry: { date: { gte: period.from, lte: period.to } } },
            include: { account: { select: { type: true } } },
          },
        },
        orderBy: { code: "asc" },
      })
    : [];

  // Hours logged against a job in this period that have not been charged yet.
  // Shown before posting so nobody runs it blind.
  const waiting = companyId
    ? await db.timesheet.findMany({
        where: { companyId, jobId: { not: null }, entryId: null, date: { gte: period.from, lte: period.to } },
        select: { hours: true, costRate: true },
      })
    : [];
  const pendingLabour = {
    entries: waiting.length,
    hours: waiting.reduce((t, w) => t + w.hours, 0),
    amount: waiting.reduce((t, w) => t + lineCost(w.hours, w.costRate), 0),
  };

  const parties = companyId
    ? await db.party.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } })
    : [];

  // Revenue is what the job earned, cost is what it consumed. Both come from
  // the accounts the lines were posted to, so the figures cannot drift from
  // the ledgers.
  // What each job earned and consumed in its own right. Nothing is posted to a
  // parent, so a parent's figures are the sum of what sits beneath it — derived
  // every time rather than stored, because a stored total drifts the moment a
  // voucher is reversed.
  const ownRevenue = new Map<string, number>();
  const ownCost = new Map<string, number>();
  const ownContract = new Map<string, number>();
  const ownBudget = new Map<string, number>();
  for (const j of jobs) {
    let revenue = 0;
    let cost = 0;
    for (const l of j.lines) {
      const net = l.debit - l.credit;
      if (l.account.type === "Income") revenue += -net; // income sits as a credit
      else if (l.account.type === "Expense") cost += net;
    }
    ownRevenue.set(j.id, revenue);
    ownCost.set(j.id, cost);
    ownContract.set(j.id, j.contractValue);
    ownBudget.set(j.id, j.budgetCost);
  }

  const costed = arrange(jobs).map((row) => {
    const j = row.node;
    // A parent shows the whole contract; a leaf shows only itself. Either way
    // the figure is the sum over the row and everything under it.
    const revenue = withDescendants(row, ownRevenue);
    const cost = withDescendants(row, ownCost);
    // Named apart from the stored fields on purpose. These are totals including
    // sub-jobs; the row's own contractValue and budgetCost still mean what is in
    // the database, because the edit form is filled from this object and would
    // otherwise write the roll-up back and double-count every variation.
    const rolledContract = withDescendants(row, ownContract);
    const rolledBudget = withDescendants(row, ownBudget);
    const margin = revenue - cost;
    return {
      ...j,
      depth: row.depth,
      hasChildren: row.hasChildren,
      rolledContract,
      rolledBudget,
      revenue,
      cost,
      margin,
      marginPct: revenue > 0 ? margin / revenue : 0,
      budgetUsed: rolledBudget > 0 ? cost / rolledBudget : 0,
      overBudget: rolledBudget > 0 && cost > rolledBudget,
    };
  });

  // Summed over the raw jobs, not the rolled-up rows: adding a parent to its own
  // children would count the same contract twice.
  const totals = jobs.reduce(
    (t, j) => ({
      contract: t.contract + j.contractValue,
      budget: t.budget + j.budgetCost,
      revenue: t.revenue + (ownRevenue.get(j.id) ?? 0),
      cost: t.cost + (ownCost.get(j.id) ?? 0),
      margin: t.margin + (ownRevenue.get(j.id) ?? 0) - (ownCost.get(j.id) ?? 0),
    }),
    { contract: 0, budget: 0, revenue: 0, cost: 0, margin: 0 }
  );

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Job Costing"
        subtitle={period.label}
      />

      <PageHeader
        title="Finance — Job Costing"
        subtitle="What each job earned, what it cost, and whether it is inside its budget."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && (
            <PostLabour
              companyId={companyId}
              from={period.fromStr}
              to={period.toStr}
              pending={pendingLabour}
            />
          )}
          {companyId && <ExportButton dataset="jobs" companyId={companyId} label="Export jobs" />}
          {companyId && (
            <JobForm
              companyId={companyId}
              parties={parties}
              jobs={jobs.map((j) => ({ id: j.id, code: j.code, name: j.name }))}
            />
          )}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>
      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      {pendingLabour.entries > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">These margins are missing labour.</span>{" "}
          {pendingLabour.hours}h worth {money(pendingLabour.amount)} has been logged against jobs in this period but
          not charged to them yet. Use &ldquo;Post labour&rdquo; above.
        </div>
      )}

      {costed.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="card p-5">
            <div className="text-sm text-muted">Revenue</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{n(totals.revenue)}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-muted">Cost</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{n(totals.cost)}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-muted">Margin</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${totals.margin >= 0 ? "text-brand-green-700" : "text-red-600"}`}>
              {n(totals.margin)}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {totals.revenue > 0 ? pct(totals.margin / totals.revenue) : "—"} of revenue
            </div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-muted">Contract value</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{n(totals.contract)}</div>
            <div className="mt-0.5 text-xs text-muted">budget cost {n(totals.budget)}</div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Jobs</h2>
          <span className="text-xs text-muted">{costed.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Code</th>
              <th className="px-4 py-2 font-semibold">Job</th>
              <th className="px-4 py-2 font-semibold">Customer</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 text-right font-semibold">Revenue</th>
              <th className="px-4 py-2 text-right font-semibold">Cost</th>
              <th className="px-4 py-2 text-right font-semibold">Margin</th>
              <th className="px-4 py-2 text-right font-semibold">Budget used</th>
              <th className="px-4 py-2 font-semibold print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {costed.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  No jobs yet. Add one, then tag costs and revenue to it when posting a voucher.
                </td>
              </tr>
            )}
            {costed.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-heading">{j.code}</td>
                <td className="px-4 py-2 text-ink">
                  <span style={{ paddingLeft: `${j.depth * 18}px` }} className="inline-block">
                    {j.depth > 0 && <span className="mr-1 text-muted">&#9492;</span>}
                    {j.name}
                  </span>
                  {j.type !== "Contract" && (
                    <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-xs text-muted">{j.type}</span>
                  )}
                  {j.hasChildren && (
                    <span className="ml-2 text-xs text-muted" title="Includes every sub-job beneath it">
                      incl. sub-jobs
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted">{j.party?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor[j.status] ?? statusColor.Open}`}>
                    {j.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{n(j.revenue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(j.cost)}</td>
                <td className={`px-4 py-2 text-right font-medium tabular-nums ${j.margin >= 0 ? "text-ink" : "text-red-600"}`}>
                  {n(j.margin)}
                  {j.revenue > 0 && <span className="ml-1 text-xs font-normal text-muted">{pct(j.marginPct)}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {/* Guarded on the same figure the percentage is calculated from,
                      so a parent that carries no budget of its own but has
                      budgeted sub-jobs still shows its position. */}
                  {j.rolledBudget > 0 ? (
                    <span className={j.overBudget ? "font-medium text-red-600" : "text-muted"}>
                      {pct(j.budgetUsed)}
                      {j.overBudget && <span className="ml-1 text-xs">over</span>}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right print:hidden">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/finance/daybook?c=${companyId}&from=${period.fromStr}&to=${period.toStr}&j=${j.id}`}
                      className="rounded px-2 py-1 text-xs text-muted hover:bg-line hover:text-brand-blue-600"
                      title="Show the vouchers posted to this job"
                    >
                      Vouchers
                    </Link>
                    <JobForm companyId={companyId} parties={parties}
                      jobs={jobs.filter((o) => o.id !== j.id).map((o) => ({ id: o.id, code: o.code, name: o.name }))}
                      job={{
                      id: j.id, code: j.code, name: j.name, partyId: j.partyId,
                      type: j.type, parentId: j.parentId,
                      contractValue: j.contractValue, budgetCost: j.budgetCost,
                      startDate: j.startDate ? j.startDate.toISOString().slice(0, 10) : null,
                      endDate: j.endDate ? j.endDate.toISOString().slice(0, 10) : null,
                      status: j.status, notes: j.notes,
                    }} />
                    <GuardedDelete screen="finance.jobs" action={deleteJob.bind(null, j.id)} label={`Delete job ${j.code}?`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {costed.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                <td className="px-4 py-2" colSpan={4}>Total</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{n(totals.revenue)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{n(totals.cost)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${totals.margin >= 0 ? "text-ink" : "text-red-600"}`}>
                  {n(totals.margin)}
                </td>
                <td className="px-4 py-2" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Revenue and cost come from the accounts each voucher line was posted to, for the period above — so these
        figures always agree with the ledgers. An indented row is a package or variation under the job above it;
        the parent&rsquo;s figures include everything beneath it, while the total at the foot counts each job once.
        A line with no job is not counted here — tag it on the voucher, or put it on a cost centre if it is your
        own overhead.
      </p>
    </div>
  );
}
