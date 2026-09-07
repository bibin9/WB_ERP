import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PeriodPicker from "@/components/PeriodPicker";
import PrintReport from "@/components/finance/PrintReport";
import ExportButton from "@/components/ExportButton";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { broughtForward, periodMovement, balanceAsAt, openingInPeriod } from "@/lib/ledger";
import { money } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * The trial balance.
 *
 * The first report an auditor asks for and the first thing an accountant checks
 * at month-end. Four columns, because two is not enough to work with: what the
 * account brought in, what moved through it in the period, and where it closed.
 * A two-column trial balance shows only the closing position, so when it does
 * not agree there is nothing to look at.
 *
 * Amounts are held signed — debit positive — and split into Dr and Cr columns
 * only for display, which is why the two totals always agree unless a voucher
 * is genuinely unbalanced. That makes the foot of this report a real control:
 * if it does not balance, something is wrong with the data, not the arithmetic.
 */

/** A signed balance split into the column it belongs in. */
const dr = (v: number) => (v > 0 ? v : 0);
const cr = (v: number) => (v < 0 ? -v : 0);

const TYPE_ORDER: Record<string, number> = { Asset: 0, Liability: 1, Equity: 2, Income: 3, Expense: 4 };

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; from?: string; to?: string; z?: string }>;
}) {
  await requireAccess("finance.reports");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);
  const openingAsOf = company?.openingAsOf ?? null;

  // Accounts that never moved and have no balance are noise on a printed report,
  // so they are hidden unless asked for.
  const showAll = sp.z === "1";

  const accounts = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId },
        include: { lines: { include: { entry: { select: { date: true } } } } },
        orderBy: { code: "asc" },
      })
    : [];

  const rows = accounts
    .map((a) => {
      const opening = broughtForward(a, period.from, openingAsOf);
      const moved = periodMovement(a, period.from, period.to, openingAsOf);
      const closing = balanceAsAt(a, period.to, openingAsOf);
      // Debit and credit turnover for the period, as an auditor expects to see
      // them: gross movement each way, not the net.
      const inPeriod = a.lines.filter((l) => l.entry.date >= period.from && l.entry.date <= period.to);
      // When the books were brought onto the system inside this period, the
      // opening balance is itself movement and has to appear in a column —
      // otherwise the turnover columns would not add across to the closing one
      // and the report would look out of balance when it is not.
      const openingHere = openingInPeriod(openingAsOf, period.from, period.to) ? a.openingBalance : 0;
      const periodDr = inPeriod.reduce((s, l) => s + l.debit, 0) + dr(openingHere);
      const periodCr = inPeriod.reduce((s, l) => s + l.credit, 0) + cr(openingHere);
      return { ...a, opening, periodDr, periodCr, closing, moved };
    })
    .filter((r) => showAll || Math.abs(r.opening) > 0.004 || Math.abs(r.closing) > 0.004 || r.periodDr > 0.004 || r.periodCr > 0.004)
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.code.localeCompare(b.code));

  const total = rows.reduce(
    (t, r) => ({
      openingDr: t.openingDr + dr(r.opening),
      openingCr: t.openingCr + cr(r.opening),
      periodDr: t.periodDr + r.periodDr,
      periodCr: t.periodCr + r.periodCr,
      closingDr: t.closingDr + dr(r.closing),
      closingCr: t.closingCr + cr(r.closing),
    }),
    { openingDr: 0, openingCr: 0, periodDr: 0, periodCr: 0, closingDr: 0, closingCr: 0 }
  );

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const balanced =
    r2(total.openingDr) === r2(total.openingCr) &&
    r2(total.periodDr) === r2(total.periodCr) &&
    r2(total.closingDr) === r2(total.closingCr);

  const cell = "px-3 py-2 text-right tabular-nums";
  const num = (v: number) => (v > 0.004 ? money(v) : <span className="text-muted">&mdash;</span>);

  return (
    <div>
      <div className="print-header mb-4 border-b border-line pb-3">
        <div className="text-lg font-bold text-heading">{companyName}</div>
        <div className="text-sm text-ink">Trial Balance</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>

      <PageHeader
        title="Finance — Trial Balance"
        subtitle="What each account brought forward, what moved through it in the period, and where it closed."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <ExportButton dataset="trialBalance" companyId={companyId} label="Export" />}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>
      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      <div
        className={`mb-5 rounded-lg border px-4 py-3 text-sm print:hidden ${
          balanced ? "border-brand-green/40 bg-brand-green/5 text-ink" : "border-red-300 bg-red-50 text-red-700"
        }`}
      >
        {balanced ? (
          <>
            <span className="font-semibold text-brand-green-700">&#10003; In balance.</span> Debits equal credits in
            all three pairs of columns, so nothing is missing a side.
          </>
        ) : (
          <>
            <span className="font-semibold">Out of balance.</span> Debits and credits disagree, which means a voucher
            was written without an equal other side. Nothing else in Finance can be relied on until this is found.
          </>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-xs uppercase text-muted">
              <th className="px-3 py-2 text-left font-semibold">Code</th>
              <th className="px-3 py-2 text-left font-semibold">Account</th>
              <th className="px-3 py-2 text-right font-semibold" colSpan={2}>
                Opening
              </th>
              <th className="px-3 py-2 text-right font-semibold" colSpan={2}>
                In the period
              </th>
              <th className="px-3 py-2 text-right font-semibold" colSpan={2}>
                Closing
              </th>
            </tr>
            <tr className="border-b border-line bg-brand-paper text-xs uppercase text-muted">
              <th /> <th />
              <th className="px-3 pb-2 text-right font-normal">Dr</th>
              <th className="px-3 pb-2 text-right font-normal">Cr</th>
              <th className="px-3 pb-2 text-right font-normal">Dr</th>
              <th className="px-3 pb-2 text-right font-normal">Cr</th>
              <th className="px-3 pb-2 text-right font-normal">Dr</th>
              <th className="px-3 pb-2 text-right font-normal">Cr</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  Nothing posted in this period.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-heading">{r.code}</td>
                <td className="px-3 py-2 text-ink">
                  {r.name}
                  <span className="ml-2 text-xs text-muted">{r.type}</span>
                </td>
                <td className={cell}>{num(dr(r.opening))}</td>
                <td className={cell}>{num(cr(r.opening))}</td>
                <td className={cell}>{num(r.periodDr)}</td>
                <td className={cell}>{num(r.periodCr)}</td>
                <td className={`${cell} font-medium`}>{num(dr(r.closing))}</td>
                <td className={`${cell} font-medium`}>{num(cr(r.closing))}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-brand-paper font-semibold text-heading">
                <td className="px-3 py-2" colSpan={2}>
                  Total
                </td>
                <td className={cell}>{money(total.openingDr)}</td>
                <td className={cell}>{money(total.openingCr)}</td>
                <td className={cell}>{money(total.periodDr)}</td>
                <td className={cell}>{money(total.periodCr)}</td>
                <td className={cell}>{money(total.closingDr)}</td>
                <td className={cell}>{money(total.closingCr)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Opening is everything up to the day before the period starts, including any opening balances entered when the
        books were brought onto the system. &ldquo;In the period&rdquo; is the gross debit and credit turnover, not
        the net, which is what an auditor asks to see. Accounts with no balance and no movement are hidden;{" "}
        <a
          className="underline"
          href={`/finance/trial-balance?c=${companyId}&from=${period.fromStr}&to=${period.toStr}&z=${showAll ? "0" : "1"}`}
        >
          {showAll ? "hide them again" : "show every account"}
        </a>
        .
      </p>
    </div>
  );
}
