import Link from "next/link";
import { HardHat, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { arrange, withDescendants } from "@/lib/tree";
import { contractState, summariseWip, wipVerdict, rankContracts } from "@/lib/wip";

export const dynamic = "force-dynamic";

/**
 * Work in progress and contract status.
 *
 * Deliberately not period-filtered. Every other finance report answers a
 * question about a stretch of time; this one answers "where does this contract
 * stand", which is cumulative from the day it started. Filtering it to a
 * financial year would restart every contract each January and report a
 * two-year job as barely begun.
 */

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

const positionColour: Record<string, string> = {
  "Over-billed": "bg-brand-gold/10 text-brand-gold",
  "Under-billed": "bg-brand-blue/10 text-brand-blue-600",
  "In line": "bg-brand-green/10 text-brand-green-700",
  "Not measurable": "bg-line text-muted",
};

export default async function WipPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; show?: string }>;
}) {
  await requireAccess("finance.wip");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const showAll = sp.show === "all";

  // Every line ever charged to a job, not a period's worth. See the note above.
  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId, ...(showAll ? {} : { status: { in: ["Open", "On hold"] } }) },
        include: {
          party: { select: { name: true } },
          lines: { include: { account: { select: { type: true } } } },
        },
        orderBy: { code: "asc" },
      })
    : [];

  // What each job earned and consumed in its own right. Nothing is posted to a
  // parent, so a parent's figures are the sum of what sits beneath it.
  const ownCost = new Map<string, number>();
  const ownBilled = new Map<string, number>();
  const ownValue = new Map<string, number>();
  const ownBudget = new Map<string, number>();
  for (const j of jobs) {
    let billed = 0;
    let cost = 0;
    for (const l of j.lines) {
      const net = l.debit - l.credit;
      if (l.account.type === "Income") billed += -net; // income sits as a credit
      else if (l.account.type === "Expense") cost += net;
    }
    ownCost.set(j.id, cost);
    ownBilled.set(j.id, billed);
    ownValue.set(j.id, j.contractValue);
    ownBudget.set(j.id, j.budgetCost);
  }

  const arranged = arrange(jobs);
  const contracts = arranged.map((row) => {
    const j = row.node;
    return {
      id: j.id,
      code: j.code,
      name: j.name,
      status: j.status,
      type: j.type,
      depth: row.depth,
      partyName: j.party?.name ?? null,
      startDate: j.startDate,
      endDate: j.endDate,
      contractValue: withDescendants(row, ownValue),
      budgetCost: withDescendants(row, ownBudget),
      costToDate: withDescendants(row, ownCost),
      billedToDate: withDescendants(row, ownBilled),
    };
  });

  // Only top-level rows are totalled, or a main contract and its packages would
  // both be counted and every figure would double.
  const roots = contracts.filter((c) => c.depth === 0);
  const totals = summariseWip(roots);
  const verdict = wipVerdict(roots);

  // Worst first: a contract heading for a loss is the only thing on this screen
  // somebody can still act on.
  const ranked = rankContracts(contracts.filter((c) => c.depth === 0));
  const childrenOf = (id: string) => contracts.filter((c) => c.depth > 0 && arranged.find((r) => r.node.id === c.id)?.node.parentId === id);

  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Work in Progress & Contract Status"
        subtitle="life to date"
      />

      <PageHeader
        title="Finance — Work in Progress"
        subtitle="How far through each contract is, and whether the billing has run ahead of the work."
      >
        <PrintReport />
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <p className="mb-5 text-sm text-ink">{verdict}</p>

      {totals.onerousCount > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {totals.onerousCount === 1
              ? "One contract is expected to finish at a loss."
              : `${totals.onerousCount} contracts are expected to finish at a loss.`}
          </span>{" "}
          The whole {money(totals.expectedLosses)} belongs in this period, not spread over the months left. A loss
          you recognise now is still a decision; one deferred to the last month is only an explanation.
        </div>
      )}

      {totals.unbudgeted > 0 && (
        <div className="mb-5 rounded-lg border border-line bg-brand-paper px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {totals.unbudgeted === 1
              ? "One contract has no budget cost."
              : `${totals.unbudgeted} contracts have no budget cost.`}
          </span>{" "}
          Nothing about how far through they are can be worked out, so they are shown but left out of the totals.
          Set a budget on the job to bring them in.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={card}>
          <div className="text-sm text-muted">Contract value</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.contractValue)}</div>
          <div className="mt-0.5 text-xs text-muted">
            {totals.contracts} contract{totals.contracts === 1 ? "" : "s"}, {money(totals.costToDate)} spent
          </div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Earned so far</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.revenueEarned)}</div>
          <div className="mt-0.5 text-xs text-muted">against {money(totals.billedToDate)} invoiced</div>
        </div>
        <div className={`${card} ${totals.contractAssets > 0 ? "border-brand-blue/40" : ""}`}>
          <div className="text-sm text-muted">Done, not yet billed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.contractAssets)}</div>
          <div className="mt-0.5 text-xs text-muted">earned and never invoiced</div>
        </div>
        <div className={`${card} ${totals.contractLiabilities > 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {totals.contractLiabilities > 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Billed ahead of the work
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
            {money(totals.contractLiabilities)}
          </div>
          <div className="mt-0.5 text-xs text-muted">held against work still owed</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`/finance/wip?c=${companyId}`}
            className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}
          >
            Live contracts
          </a>
          <span className="text-line">|</span>
          <a
            href={`/finance/wip?c=${companyId}&show=all`}
            className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}
          >
            All
          </a>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Contract</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 text-right font-medium">Value</th>
              <th className="px-4 py-2.5 text-right font-medium">Spent</th>
              <th className="px-4 py-2.5 text-right font-medium">Complete</th>
              <th className="px-4 py-2.5 text-right font-medium">Earned</th>
              <th className="px-4 py-2.5 text-right font-medium">Billed</th>
              <th className="px-4 py-2.5 text-right font-medium">Difference</th>
              <th className="px-4 py-2.5 font-medium">Position</th>
              <th className="px-4 py-2.5 text-right font-medium">Forecast margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted">
                  No contracts to report on. Add a job with a contract value and a budget cost to see where it stands.
                </td>
              </tr>
            )}
            {ranked.map((c) => {
              const s = contractState(c);
              const diff = s.overBilled > 0 ? s.overBilled : s.underBilled;
              return (
                <tr key={c.id} className={s.onerous ? "bg-brand-gold/5" : ""}>
                  <td className="px-4 py-2.5">
                    <Link href={`/finance/jobs`} className="font-mono text-xs text-brand-blue-600 hover:underline">
                      {c.code}
                    </Link>
                    <div className="text-ink">{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.type} · {c.status} · {fmtDate(c.startDate)} to {fmtDate(c.endDate)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.partyName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(c.contractValue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {money(c.costToDate)}
                    {s.overspent && (
                      <div className="text-xs text-brand-gold">over budget</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {s.percentComplete === null ? (
                      <span className="text-muted" title="No budget cost is set on this job">
                        budget not set
                      </span>
                    ) : (
                      pct(s.percentComplete)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {s.revenueEarned === null ? "—" : money(s.revenueEarned)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(c.billedToDate)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                    {diff > 0 ? money(diff) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${positionColour[s.position]}`}>
                      {s.position}
                    </span>
                    {s.onerous && (
                      <div className="mt-0.5 text-xs font-medium text-brand-gold">
                        loss {money(s.expectedLoss)}
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      s.forecastMargin !== null && s.forecastMargin < 0 ? "text-brand-gold" : "text-ink"
                    }`}
                  >
                    {s.forecastMargin === null ? "—" : money(s.forecastMargin)}
                    {s.forecastMarginShare !== null && (
                      <div className="text-xs text-muted">{Math.round(s.forecastMarginShare * 100)}%</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <HardHat className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          How far through a contract is, is measured by cost: what has been spent against what it was priced to cost.
          The value earned follows from that, and the difference against what has actually been invoiced is what this
          report exists to show. Billed ahead of the work is money held against work still owed, not profit. Work done
          and not yet billed is earned money nobody has asked the client for. Sub-jobs are rolled into their parent, so
          a main contract shows a true total with nothing posted against it directly.
        </p>
      </div>
    </div>
  );
}
