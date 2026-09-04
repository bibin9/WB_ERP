import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PeriodPicker from "@/components/PeriodPicker";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { balanceAsAt, periodMovement } from "@/lib/ledger";

export const dynamic = "force-dynamic";
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ label, amount, bold }: { label: string; amount: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-1.5 text-sm ${bold ? "font-semibold text-ink" : "text-ink"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{n(amount)}</span>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ c?: string; from?: string; to?: string }> }) {
  await requireAccess("finance.reports");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);
  const openingAsOf = company?.openingAsOf ?? null;

  const accounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId },
        include: { lines: { select: { debit: true, credit: true, entry: { select: { date: true } } } } },
        orderBy: { code: "asc" },
      })
    : [];

  // P&L is the movement in the period; the Balance Sheet is cumulative to its end.
  const byType = (t: string, cumulative: boolean) =>
    accounts
      .filter((a) => a.type === t)
      .map((a) => ({
        name: `${a.code} ${a.name}`,
        net: cumulative ? balanceAsAt(a, period.to, openingAsOf) : periodMovement(a, period.from, period.to, openingAsOf),
      }))
      .filter((x) => Math.abs(x.net) > 0.001);

  const income = byType("Income", false).map((x) => ({ ...x, amt: -x.net })); // credit balance = income
  const expense = byType("Expense", false).map((x) => ({ ...x, amt: x.net }));
  const totalIncome = income.reduce((s, x) => s + x.amt, 0);
  const totalExpense = expense.reduce((s, x) => s + x.amt, 0);
  const netProfit = totalIncome - totalExpense;

  const assets = byType("Asset", true).map((x) => ({ ...x, amt: x.net }));
  const liabilities = byType("Liability", true).map((x) => ({ ...x, amt: -x.net }));
  const equity = byType("Equity", true).map((x) => ({ ...x, amt: -x.net }));
  const totalAssets = assets.reduce((s, x) => s + x.amt, 0);
  const totalLiab = liabilities.reduce((s, x) => s + x.amt, 0);

  // Retained earnings on the Balance Sheet must be profit since the books
  // opened, not just this period's — otherwise the sheet stops balancing the
  // moment you narrow the dates.
  const cumulativeIncome = byType("Income", true).reduce((s, x) => s - x.net, 0);
  const cumulativeExpense = byType("Expense", true).reduce((s, x) => s + x.net, 0);
  const retained = cumulativeIncome - cumulativeExpense;
  const totalEquity = equity.reduce((s, x) => s + x.amt, 0) + retained;
  const liabPlusEquity = totalLiab + totalEquity;

  return (
    <div>
      <PageHeader title="Finance — Reports" subtitle="Profit & Loss for the period and Balance Sheet as at its end date, live from the ledgers." />
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>
      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* P&L */}
        <div className="card">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Profit &amp; Loss</h2></div>
          <div className="py-2">
            <div className="px-5 pb-1 pt-2 text-xs font-semibold uppercase text-muted">Income</div>
            {income.length === 0 && <div className="px-5 py-1 text-sm text-muted">—</div>}
            {income.map((x) => <Row key={x.name} label={x.name} amount={x.amt} />)}
            <Row label="Total Income" amount={totalIncome} bold />
            <div className="mx-5 my-2 border-t border-line" />
            <div className="px-5 pb-1 text-xs font-semibold uppercase text-muted">Expenses</div>
            {expense.length === 0 && <div className="px-5 py-1 text-sm text-muted">—</div>}
            {expense.map((x) => <Row key={x.name} label={x.name} amount={x.amt} />)}
            <Row label="Total Expenses" amount={totalExpense} bold />
          </div>
          <div className={`flex items-center justify-between border-t-2 border-line px-5 py-3 font-bold ${netProfit >= 0 ? "text-brand-green-700" : "text-red-600"}`}>
            <span>{netProfit >= 0 ? "Net Profit" : "Net Loss"}</span>
            <span className="tabular-nums">{n(Math.abs(netProfit))}</span>
          </div>
        </div>

        {/* Balance Sheet */}
        <div className="card">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Balance Sheet</h2></div>
          <div className="py-2">
            <div className="px-5 pb-1 pt-2 text-xs font-semibold uppercase text-muted">Assets</div>
            {assets.map((x) => <Row key={x.name} label={x.name} amount={x.amt} />)}
            <Row label="Total Assets" amount={totalAssets} bold />
            <div className="mx-5 my-2 border-t border-line" />
            <div className="px-5 pb-1 text-xs font-semibold uppercase text-muted">Liabilities</div>
            {liabilities.map((x) => <Row key={x.name} label={x.name} amount={x.amt} />)}
            <Row label="Total Liabilities" amount={totalLiab} bold />
            <div className="mx-5 my-2 border-t border-line" />
            <div className="px-5 pb-1 text-xs font-semibold uppercase text-muted">Equity</div>
            {equity.map((x) => <Row key={x.name} label={x.name} amount={x.amt} />)}
            <Row label={netProfit >= 0 ? "Add: Net Profit" : "Less: Net Loss"} amount={netProfit} />
            <Row label="Total Equity" amount={totalEquity} bold />
          </div>
          <div className="flex items-center justify-between border-t-2 border-line px-5 py-3 font-bold text-ink">
            <span>Liabilities + Equity</span>
            <span className="tabular-nums">{n(liabPlusEquity)}</span>
          </div>
          <div className={`px-5 pb-3 text-xs ${Math.abs(totalAssets - liabPlusEquity) < 0.01 ? "text-brand-green-700" : "text-red-600"}`}>
            {Math.abs(totalAssets - liabPlusEquity) < 0.01 ? "✓ Balanced" : `Difference: ${n(totalAssets - liabPlusEquity)}`}
          </div>
        </div>
      </div>
    </div>
  );
}
