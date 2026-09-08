import Link from "next/link";
import { Landmark, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import ClearLine from "@/components/finance/ClearLine";
import StatementControls from "@/components/finance/StatementControls";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { balanceAsAt } from "@/lib/ledger";
import { reconcile, daysOutstanding, isStale, STALE_DAYS } from "@/lib/bankrec";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function BankRecPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; a?: string; d?: string; b?: string; s?: string; show?: string }>;
}) {
  await requireAccess("finance.bankrec");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  // Only accounts that hold money can be reconciled against a statement.
  const bankAccounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId, type: "Asset", OR: [{ code: { startsWith: "10" } }, { name: { contains: "Bank" } }, { name: { contains: "Cash" } }] },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];
  const accountId = bankAccounts.find((a) => a.id === sp.a)?.id ?? bankAccounts[0]?.id ?? "";
  const account = bankAccounts.find((a) => a.id === accountId);

  const statementDate = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : new Date().toISOString().slice(0, 10);
  const asAt = new Date(statementDate + "T23:59:59.999Z");
  const statementRef = (sp.s ?? "").slice(0, 40);
  const statementBalance = sp.b !== undefined && sp.b !== "" && Number.isFinite(Number(sp.b)) ? Number(sp.b) : null;
  const showCleared = sp.show === "all";

  // The ledger balance as at the statement date, opening balance included.
  const accountWithLines = accountId
    ? await db.chartOfAccount.findUnique({
        where: { id: accountId },
        include: { lines: { include: { entry: { select: { date: true } } } } },
      })
    : null;
  const perBooks = accountWithLines ? balanceAsAt(accountWithLines, asAt, company?.openingAsOf) : 0;

  // Every line up to the statement date. Reconciling means explaining the ones
  // the bank has not shown, so cleared lines are hidden unless asked for.
  const lines = accountId
    ? await db.journalLine.findMany({
        where: {
          accountId,
          entry: { companyId, date: { lte: asAt } },
          ...(showCleared ? {} : { clearedOn: null }),
        },
        include: { entry: { select: { reference: true, date: true, voucherType: true, memo: true, partyName: true } } },
        orderBy: [{ entry: { date: "asc" } }],
        take: 500,
      })
    : [];

  // The reconciliation itself is worked out over every uncleared line, not just
  // the page — the whole point is that nothing is left out of the explanation.
  const allUpTo = accountId
    ? await db.journalLine.findMany({
        where: { accountId, entry: { companyId, date: { lte: asAt } } },
        select: { debit: true, credit: true, clearedOn: true },
      })
    : [];
  const rec = reconcile(
    allUpTo.map((l) => ({ amount: l.debit - l.credit, clearedOn: l.clearedOn })),
    perBooks,
    statementBalance
  );

  const stale = lines.filter((l) => !l.clearedOn && isStale(l.entry.date, asAt)).length;
  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title={`Bank Reconciliation — ${account ? `${account.code} ${account.name}` : ""}`}
        subtitle={`as at ${fmt(asAt)}${statementRef ? ` · ${statementRef}` : ""}`}
      />

      <PageHeader
        title="Finance — Bank Reconciliation"
        subtitle="Explain the difference between your books and the bank statement, line by line."
      >
        <PrintReport />
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
        {bankAccounts.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Account:</span>
            <div className="flex flex-wrap gap-1">
              {bankAccounts.map((a) => (
                <Link
                  key={a.id}
                  href={`/finance/bank-rec?c=${companyId}&a=${a.id}&d=${statementDate}${statementRef ? `&s=${encodeURIComponent(statementRef)}` : ""}`}
                  className={`rounded px-2 py-1 text-xs ${a.id === accountId ? "bg-brand-blue/10 font-medium text-brand-blue-600" : "text-muted hover:bg-line"}`}
                >
                  {a.code} {a.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {bankAccounts.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-muted">
          No bank or cash account in this company&rsquo;s chart yet. Add one under Ledgers.
        </div>
      ) : (
        <>
          <div className="mb-5">
            <StatementControls
              companyId={companyId}
              accountId={accountId}
              statementDate={statementDate}
              statementBalance={statementBalance === null ? "" : String(statementBalance)}
              statementRef={statementRef}
              unclearedCount={rec.unclearedCount}
            />
          </div>

          {/* The four figures an accountant writes at the foot of a reconciliation. */}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className={card}>
              <div className="text-sm text-muted">Per your books</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(rec.perBooks)}</div>
              <div className="mt-0.5 text-xs text-muted">{account?.code} as at {fmt(asAt)}</div>
            </div>
            <div className={card}>
              <div className="text-sm text-muted">Not yet on the statement</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">
                {money(rec.unclearedPayments - rec.unclearedReceipts)}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {money(rec.unclearedPayments)} out, {money(rec.unclearedReceipts)} in
              </div>
            </div>
            <div className={card}>
              <div className="text-sm text-muted">So the statement should read</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(rec.expectedStatement)}</div>
              <div className="mt-0.5 text-xs text-muted">{rec.unclearedCount} item(s) still to clear</div>
            </div>
            <div className={`${card} ${statementBalance !== null && !rec.reconciled ? "border-red-300" : rec.reconciled ? "border-brand-green/40" : ""}`}>
              <div className="text-sm text-muted">Difference</div>
              {statementBalance === null ? (
                <>
                  <div className="mt-1 text-2xl font-bold text-muted">&mdash;</div>
                  <div className="mt-0.5 text-xs text-muted">enter the statement balance above</div>
                </>
              ) : (
                <>
                  <div className={`mt-1 text-2xl font-bold tabular-nums ${rec.reconciled ? "text-brand-green-700" : "text-red-600"}`}>
                    {money(rec.difference)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {rec.reconciled ? "reconciled" : "unexplained — keep looking"}
                  </div>
                </>
              )}
            </div>
          </div>

          {stale > 0 && (
            <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
              <AlertTriangle className="mr-1 inline h-4 w-4 text-brand-gold" />
              <span className="font-semibold">
                {stale} item{stale === 1 ? " has" : "s have"} been outstanding more than {STALE_DAYS} days.
              </span>{" "}
              A cheque that old will generally be refused by the bank, so it is not a timing difference any more —
              it needs writing back.
            </div>
          )}

          <div className="card overflow-x-auto">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <Landmark className="h-5 w-5 text-heading" />
              <h2 className="font-semibold text-heading">
                {showCleared ? "Every line up to the statement date" : "Not yet on the statement"}
              </h2>
              <span className="ml-auto text-xs text-muted">
                {rec.clearedCount} ticked · {rec.unclearedCount} outstanding
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                  <th className="px-3 py-2 font-semibold print:hidden">On statement</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Voucher</th>
                  <th className="px-3 py-2 font-semibold">Details</th>
                  <th className="px-3 py-2 text-right font-semibold">In</th>
                  <th className="px-3 py-2 text-right font-semibold">Out</th>
                  <th className="px-3 py-2 font-semibold">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted">
                      {showCleared
                        ? "Nothing on this account up to that date."
                        : "Everything up to that date is on the statement. This account is reconciled."}
                    </td>
                  </tr>
                )}
                {lines.map((l) => {
                  const days = daysOutstanding(l.entry.date, asAt);
                  const old = !l.clearedOn && isStale(l.entry.date, asAt);
                  return (
                    <tr key={l.id} className={old ? "bg-brand-gold/5" : ""}>
                      <td className="px-3 py-2 print:hidden">
                        <ClearLine
                          lineId={l.id}
                          cleared={!!l.clearedOn}
                          statementDate={statementDate}
                          statementRef={statementRef}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{fmt(l.entry.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-heading">{l.entry.reference}</td>
                      <td className="px-3 py-2 text-ink">
                        {l.entry.partyName ?? l.entry.voucherType}
                        {l.entry.memo && <div className="text-xs text-muted">{l.entry.memo}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.debit > 0 ? money(l.debit) : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.credit > 0 ? money(l.credit) : <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {l.clearedOn ? (
                          <span className="text-brand-green-700">ticked {fmt(l.clearedOn)}</span>
                        ) : (
                          <span className={old ? "font-medium text-brand-gold" : "text-muted"}>{days}d</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted">
            The books and the bank almost never agree, and usually for a good reason: a cheque written last week may
            not have been presented. Tick each line the statement shows, and whatever difference is left is a real
            problem rather than a timing one.{" "}
            <Link
              className="underline"
              href={`/finance/bank-rec?c=${companyId}&a=${accountId}&d=${statementDate}&show=${showCleared ? "open" : "all"}${statementRef ? `&s=${encodeURIComponent(statementRef)}` : ""}`}
            >
              {showCleared ? "Show only what is outstanding" : "Show ticked lines too"}
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
