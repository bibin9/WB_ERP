import Link from "next/link";
import { Building2, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PeriodPicker from "@/components/PeriodPicker";
import PrintReport from "@/components/finance/PrintReport";
import GuardedDelete from "@/components/GuardedDelete";
import ExportButton from "@/components/ExportButton";
import CostCentreForm from "@/components/finance/CostCentreForm";
import { deleteCostCentre } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { arrange, withDescendants } from "@/lib/tree";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function CostCentresPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; from?: string; to?: string }>;
}) {
  await requireAccess("finance.costcentres");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);

  const centres = companyId
    ? await db.costCentre.findMany({
        where: { companyId },
        include: {
          lines: {
            where: { entry: { date: { gte: period.from, lte: period.to } } },
            include: { account: { select: { type: true } } },
          },
        },
        orderBy: { code: "asc" },
      })
    : [];

  // What each centre carried in its own right. A parent's figure is derived
  // from these, never posted to directly.
  const ownCost = new Map<string, number>();
  const ownIncome = new Map<string, number>();
  for (const c of centres) {
    let cost = 0;
    let income = 0;
    for (const l of c.lines) {
      const net = l.debit - l.credit;
      if (l.account.type === "Expense") cost += net;
      else if (l.account.type === "Income") income += -net;
    }
    ownCost.set(c.id, cost);
    ownIncome.set(c.id, income);
  }

  const rows = arrange(centres);

  // The figure this screen exists to make visible: expense that carries neither
  // a job nor a cost centre. Before there was a second dimension it was
  // indistinguishable from a genuine overhead, so nobody could tell whether the
  // job margins were trustworthy.
  const untagged = companyId
    ? await db.journalLine.aggregate({
        where: {
          jobId: null,
          costCentreId: null,
          account: { companyId, type: "Expense" },
          entry: { companyId, date: { gte: period.from, lte: period.to } },
        },
        _sum: { debit: true, credit: true },
      })
    : null;
  const untaggedCost = (untagged?._sum.debit ?? 0) - (untagged?._sum.credit ?? 0);

  const totalOverhead = [...ownCost.values()].reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="print-header mb-4 border-b border-line pb-3">
        <div className="text-lg font-bold text-heading">{companyName}</div>
        <div className="text-sm text-ink">Cost Centres</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>

      <PageHeader
        title="Finance — Cost Centres"
        subtitle="What the parts of your own business cost to run, when no single customer job is paying for them."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <ExportButton dataset="costCentres" companyId={companyId} label="Export cost centres" />}
          {companyId && (
            <CostCentreForm
              companyId={companyId}
              centres={centres.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
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

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <div className="text-sm text-muted">Overhead on cost centres</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{n(totalOverhead)}</div>
          <div className="mt-0.5 text-xs text-muted">cost you have deliberately booked to the business</div>
        </div>
        <div className={`card p-5 ${untaggedCost > 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {untaggedCost > 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Cost with nothing on it
          </div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${untaggedCost > 0 ? "text-brand-gold" : "text-heading"}`}>
            {n(untaggedCost)}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {untaggedCost > 0 ? (
              <>
                no job and no cost centre — until this is nil, job margins are flattering.{" "}
                <Link
                  href={`/finance/daybook?c=${companyId}&from=${period.fromStr}&to=${period.toStr}`}
                  className="underline"
                >
                  Find it in the Day Book
                </Link>
              </>
            ) : (
              "every cost in this period is tagged"
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Building2 className="h-5 w-5 text-heading" />
          <h2 className="font-semibold text-heading">Cost centres</h2>
          <span className="ml-auto text-xs text-muted">{centres.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Code</th>
              <th className="px-4 py-2 font-semibold">Cost centre</th>
              <th className="px-4 py-2 text-right font-semibold">Own cost</th>
              <th className="px-4 py-2 text-right font-semibold">Including below</th>
              <th className="px-4 py-2 text-right font-semibold">Recharged</th>
              <th className="px-4 py-2 font-semibold print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No cost centres yet. Add one for the parts of the business that cost money but that no customer
                  job pays for — the workshop, the vehicles, head office.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const c = row.node;
              const own = ownCost.get(c.id) ?? 0;
              const total = withDescendants(row, ownCost);
              const income = withDescendants(row, ownIncome);
              return (
                <tr key={c.id} className={c.isActive ? "" : "opacity-55"}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-heading">{c.code}</td>
                  <td className="px-4 py-2 text-ink">
                    <span style={{ paddingLeft: `${row.depth * 18}px` }} className="inline-block">
                      {row.depth > 0 && <span className="mr-1 text-muted">&#9492;</span>}
                      {c.name}
                    </span>
                    {!c.isActive && (
                      <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-xs text-muted">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{n(own)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                    {row.hasChildren ? n(total) : <span className="text-muted">&mdash;</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{income ? n(income) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      <CostCentreForm
                        companyId={companyId}
                        centres={centres
                          .filter((o) => o.id !== c.id)
                          .map((o) => ({ id: o.id, code: o.code, name: o.name }))}
                        centre={{
                          id: c.id,
                          code: c.code,
                          name: c.name,
                          parentId: c.parentId,
                          notes: c.notes,
                          isActive: c.isActive,
                        }}
                      />
                      <GuardedDelete
                        screen="finance.costcentres"
                        action={deleteCostCentre.bind(null, c.id)}
                        label={`Delete cost centre ${c.code}?`}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        A voucher line carries either a job or a cost centre, never both — otherwise the same cost would appear in
        job costing and in overhead, and the two reports could not be read side by side. &ldquo;Own cost&rdquo; is
        what was posted to that centre itself; &ldquo;including below&rdquo; adds up everything beneath it.
      </p>
    </div>
  );
}
