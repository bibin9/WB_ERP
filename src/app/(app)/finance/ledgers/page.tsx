import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function LedgersPage({ searchParams }: { searchParams: Promise<{ c?: string; a?: string }> }) {
  await requireAccess("finance.ledgers");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const accounts = companyId ? await db.chartOfAccount.findMany({ where: { companyId }, orderBy: { code: "asc" } }) : [];
  const accountId = accounts.find((a) => a.id === sp.a)?.id ?? accounts[0]?.id ?? "";
  const account = accounts.find((a) => a.id === accountId);

  const lines = accountId
    ? await db.journalLine.findMany({ where: { accountId }, include: { entry: true }, orderBy: [{ entry: { date: "asc" } }] })
    : [];

  let running = 0;
  const rows = lines.map((l) => { running += l.debit - l.credit; return { l, running }; });
  const drSide = account && (account.type === "Asset" || account.type === "Expense");

  return (
    <div>
      <PageHeader title="Finance — Ledgers" subtitle="Statement of account with running balance — Tally's Ledger view. Pick an account to see all its entries." />
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        {/* Account list */}
        <div className="card lg:col-span-1">
          <div className="border-b border-line px-4 py-3"><h2 className="font-semibold text-brand-navy">Accounts</h2></div>
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
            <h2 className="font-semibold text-brand-navy">{account ? `${account.code} · ${account.name}` : "Ledger"}</h2>
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
                {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No entries for this account.</td></tr>}
                {rows.map(({ l, running }) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(l.entry.date)}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-brand-navy">{l.entry.reference}</td>
                    <td className="px-4 py-2 text-ink">{l.entry.memo ?? l.entry.voucherType}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.debit > 0 ? n(l.debit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.credit > 0 ? n(l.credit) : ""}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">{n(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                    <td className="px-4 py-2" colSpan={5}>Closing balance</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">{n(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
