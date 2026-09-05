import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import PeriodPicker from "@/components/PeriodPicker";
import { resolvePeriod } from "@/lib/period";
import { openingInBalance } from "@/lib/ledger";
import PrintReport from "@/components/finance/PrintReport";

export const dynamic = "force-dynamic";
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function LedgersPage({ searchParams }: { searchParams: Promise<{ c?: string; a?: string; from?: string; to?: string }> }) {
  await requireAccess("finance.ledgers");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);
  const openingAsOf = company?.openingAsOf ?? null;

  const accounts = companyId ? await db.chartOfAccount.findMany({ where: { companyId }, orderBy: { code: "asc" } }) : [];
  const accountId = accounts.find((a) => a.id === sp.a)?.id ?? accounts[0]?.id ?? "";
  const account = accounts.find((a) => a.id === accountId);

  // Everything before the period start collapses into one brought-forward line.
  const priorLines = accountId
    ? await db.journalLine.findMany({ where: { accountId, entry: { date: { lt: period.from } } }, select: { debit: true, credit: true } })
    : [];
  const carriedIn = (account && openingInBalance(openingAsOf, period.from) ? account.openingBalance : 0);
  const broughtForwardBal = priorLines.reduce((s, l) => s + l.debit - l.credit, carriedIn);

  const lines = accountId
    ? await db.journalLine.findMany({
        where: { accountId, entry: { date: { gte: period.from, lte: period.to } } },
        include: { entry: true },
        orderBy: [{ entry: { date: "asc" } }],
      })
    : [];

  let running = broughtForwardBal;
  const rows = lines.map((l) => { running += l.debit - l.credit; return { l, running }; });
  const periodDebit = lines.reduce((s, l) => s + l.debit, 0);
  const periodCredit = lines.reduce((s, l) => s + l.credit, 0);
  const drSide = account && (account.type === "Asset" || account.type === "Expense");

  return (
    <div>
      <div className="print-header mb-4 border-b border-line pb-3">
        <div className="text-lg font-bold text-heading">{companyName}</div>
        <div className="text-sm text-ink">Ledger</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>
      <PageHeader title="Finance — Ledgers" subtitle="Statement of account for the period, with balance brought forward and carried down — Tally's Ledger view." >
        <PrintReport />
      </PageHeader>
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>
      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        {/* Account list */}
        <div className="card lg:col-span-1">
          <div className="border-b border-line px-4 py-3"><h2 className="font-semibold text-heading">Accounts</h2></div>
          <div className="max-h-[540px] overflow-y-auto">
            {accounts.map((a) => (
              <Link key={a.id} href={`/finance/ledgers?c=${companyId}&a=${a.id}`}
                className={clsx("flex items-center gap-2 px-4 py-2 text-sm hover:bg-brand-paper", a.id === accountId && "bg-brand-blue/5 font-medium")}>
                <span className="w-10 font-mono text-xs text-muted">{a.code}</span>
                <span className="flex-1 truncate text-ink">{a.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Statement */}
        <div className="card lg:col-span-3 overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">{account ? `${account.code} · ${account.name}` : "Ledger"}</h2>
            {account && <span className="text-xs text-muted">{account.type}{account.parentGroup ? ` · ${account.parentGroup}` : ""}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Voucher</th>
                  <th className="px-4 py-2 font-semibold">Particulars</th>
                  <th className="px-4 py-2 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{period.fromStr}</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 italic text-muted">Balance brought forward</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-muted">
                    {n(Math.abs(broughtForwardBal))} {broughtForwardBal >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
                {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No entries in this period.</td></tr>}
                {rows.map(({ l, running }) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(l.entry.date)}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      <Link
                        href={`/finance/daybook?c=${companyId}&from=${l.entry.date.toISOString().slice(0, 10)}&to=${l.entry.date.toISOString().slice(0, 10)}&v=${encodeURIComponent(l.entry.reference)}`}
                        className="text-heading hover:text-brand-blue-600 hover:underline print:no-underline"
                        title="Show this voucher in the Day Book"
                      >
                        {l.entry.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink">{l.entry.memo ?? l.entry.voucherType}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.debit > 0 ? n(l.debit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.credit > 0 ? n(l.credit) : ""}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">{n(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                  <td className="px-4 py-2" colSpan={3}>Movement in period</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{n(periodDebit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{n(periodCredit)}</td>
                  <td className="px-4 py-2" />
                </tr>
                <tr className="bg-brand-paper font-semibold">
                  <td className="px-4 py-2" colSpan={5}>Closing balance</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{n(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
