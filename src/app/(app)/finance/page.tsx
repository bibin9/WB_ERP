import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import JournalForm from "@/components/JournalForm";
import AccountForm from "@/components/AccountForm";
import GuardedDelete from "@/components/GuardedDelete";
import { deleteAccount } from "@/app/(app)/finance/actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import ExportButton from "@/components/ExportButton";

export const dynamic = "force-dynamic";

const TYPE_ORDER = ["Asset", "Liability", "Equity", "Income", "Expense"];
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("finance.overview");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];

  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const company = accessible.find((c) => c.id === companyId);

  const accounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId },
        include: { lines: { select: { debit: true, credit: true } } },
        orderBy: { code: "asc" },
      })
    : [];

  const entries = companyId
    ? await db.journalEntry.findMany({
        where: { companyId },
        include: { lines: { include: { account: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  // Trial balance: net debit/credit per account
  const tb = accounts.map((a) => {
    const debit = a.lines.reduce((s, l) => s + l.debit, 0);
    const credit = a.lines.reduce((s, l) => s + l.credit, 0);
    const net = debit - credit; // + => debit balance
    return { ...a, net };
  });
  const totalDebit = tb.reduce((s, a) => s + (a.net > 0 ? a.net : 0), 0);
  const totalCredit = tb.reduce((s, a) => s + (a.net < 0 ? -a.net : 0), 0);

  return (
    <div>
      <PageHeader title="Finance & Accounting" subtitle="Each company keeps its own books. Chart of accounts, journal entries and trial balance.">
        <div className="flex flex-wrap items-center gap-2">
          {companyId && <ExportButton dataset="journals" companyId={companyId} label="Export journals" />}
          {companyId && <JournalForm companyId={companyId} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />}
        </div>
      </PageHeader>

      <FinanceTabs companyId={companyId} />
      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {accounts.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-muted">
          No chart of accounts for {company?.name ?? "this company"} yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {/* Trial balance */}
          <div className="card xl:col-span-2">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold text-heading">Trial Balance — {company?.code}</h2>
              <span className="text-xs text-muted">{accounts.length} accounts</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-brand-paper text-xs uppercase text-muted">
                    <th className="px-4 py-2 text-left font-semibold">Code</th>
                    <th className="px-4 py-2 text-left font-semibold">Account</th>
                    <th className="px-4 py-2 text-left font-semibold">Type</th>
                    <th className="px-4 py-2 text-right font-semibold">Debit</th>
                    <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {tb
                    .filter((a) => a.net !== 0)
                    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.code.localeCompare(b.code))
                    .map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-2 font-mono text-xs text-heading">{a.code}</td>
                        <td className="px-4 py-2 text-ink">{a.name}</td>
                        <td className="px-4 py-2 text-xs text-muted">{a.type}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{a.net > 0 ? n(a.net) : ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{a.net < 0 ? n(-a.net) : ""}</td>
                      </tr>
                    ))}
                  {totalDebit === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No postings yet. Post a journal entry to see balances.</td></tr>
                  )}
                </tbody>
                {totalDebit > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-line bg-brand-paper font-semibold text-ink">
                      <td className="px-4 py-2" colSpan={3}>Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(totalDebit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(totalCredit)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Chart of accounts */}
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold text-heading">Chart of Accounts</h2>
              <AccountForm companyId={companyId} />
            </div>
            <div className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {accounts.map((a) => (
                <div key={a.id} className="group flex items-center gap-2 px-5 py-1.5">
                  <span className="w-12 font-mono text-xs text-muted">{a.code}</span>
                  <span className="flex-1 truncate text-sm text-ink">{a.name}</span>
                  <span className="rounded bg-brand-navy/5 px-1.5 py-0.5 text-[10px] font-medium text-heading">{a.type}</span>
                  <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <AccountForm companyId={companyId} account={{ id: a.id, code: a.code, name: a.name, type: a.type }} />
                    <GuardedDelete screen="finance.ledgers" action={deleteAccount.bind(null, a.id)} label={`Delete account ${a.code}? (only if no postings)`} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Journal entries */}
      {accounts.length > 0 && (
        <div className="card mt-5">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Recent Journal Entries</h2>
          </div>
          <div className="divide-y divide-line">
            {entries.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No journal entries yet.</p>}
            {entries.map((e) => (
              <div key={e.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-heading">{e.reference}</span>
                  <span className="text-xs text-muted">by {e.postedBy}</span>
                </div>
                {e.memo && <div className="text-sm text-ink">{e.memo}</div>}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                  {e.lines.map((l) => (
                    <span key={l.id}>
                      {l.account.code} {l.debit > 0 ? `Dr ${n(l.debit)}` : `Cr ${n(l.credit)}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
