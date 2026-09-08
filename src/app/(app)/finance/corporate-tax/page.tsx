import Link from "next/link";
import { Percent, AlertTriangle, CheckCircle2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PrintReport from "@/components/finance/PrintReport";
import ExportButton from "@/components/ExportButton";
import GuardedDelete from "@/components/GuardedDelete";
import OpenTaxPeriod from "@/components/finance/OpenTaxPeriod";
import AdjustmentForm from "@/components/finance/AdjustmentForm";
import TaxReturnSettings from "@/components/finance/TaxReturnSettings";
import FileTaxReturn from "@/components/finance/FileTaxReturn";
import CorporateTaxTRN from "@/components/finance/CorporateTaxTRN";
import { deleteAdjustment, deleteReturn } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import {
  compute, filingState, CT_BAND, CT_RATE, LOSS_RELIEF_CAP,
} from "@/lib/corporatetax";
import { profitAndLoss } from "@/lib/ledger-query";

export const dynamic = "force-dynamic";

/**
 * The corporate tax return.
 *
 * Nine per cent on taxable income above AED 375,000, one return a year, filed
 * through EmaraTax within nine months of the year ending. The FTA does not want
 * the accounting profit — it wants taxable income, which is the accounting
 * profit with a list of adjustments applied to it. That list is the work, and
 * it is what usually lives in a spreadsheet nobody can find later.
 *
 * So this reads the profit straight from the ledger, holds the adjustments
 * beside it with a reason for each, and shows the arithmetic in the order the
 * FTA asks for it: adjustments, then losses capped at 75%, then the band, then
 * the rate. Every figure on the screen can be walked back to the vouchers that
 * produced it, which is the whole point of doing it here rather than in Excel.
 */

const fmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default async function CorporateTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; r?: string }>;
}) {
  await requireAccess("finance.corptax");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const returns = companyId
    ? await db.corporateTaxReturn.findMany({
        where: { companyId },
        orderBy: { periodTo: "desc" },
        include: { adjustments: true },
      })
    : [];

  const current = returns.find((r) => r.id === sp.r) ?? returns[0] ?? null;

  // The accounting profit, read the way the P&L reads it: income and expense
  // movement over the period, from the ledger itself. Nothing is keyed twice,
  // and the export and the carry-forward read it through the same helper, so
  // all three agree by construction rather than by three people writing the
  // same loop.
  const pl = current
    ? await profitAndLoss(companyId, current.periodFrom, current.periodTo, company?.openingAsOf)
    : { income: 0, expense: 0, accountingProfit: 0 };

  const c = current
    ? compute({
        accountingProfit: pl.accountingProfit,
        revenue: pl.income,
        adjustments: current.adjustments,
        lossesBroughtForward: current.lossesBroughtForward,
        sbrElected: current.sbrElected,
        periodTo: current.periodTo,
      })
    : null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const filing = current ? filingState(current.periodTo, current.status, today) : null;

  const card = "card p-5";

  /** One line of the computation, laid out the way the FTA return reads. */
  const Row = ({
    label,
    amount,
    hint,
    bold,
    rule,
    muted,
  }: {
    label: string;
    amount: number;
    hint?: string;
    bold?: boolean;
    rule?: boolean;
    muted?: boolean;
  }) => (
    <div
      className={`flex items-start justify-between gap-4 px-5 py-2 ${rule ? "border-t border-line" : ""} ${
        bold ? "font-semibold text-heading" : muted ? "text-muted" : "text-ink"
      }`}
    >
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="whitespace-nowrap tabular-nums text-sm">{money(amount)}</div>
    </div>
  );

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Corporate Tax Computation"
        subtitle={
          current
            ? `tax period ${fmt(current.periodFrom)} to ${fmt(current.periodTo)}`
            : "no tax period open"
        }
      />

      <PageHeader
        title="Finance — Corporate Tax"
        subtitle="Your yearly UAE corporate tax return, worked out from the books. Nine per cent above AED 375,000."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && current && (
            <ExportButton dataset="corporateTax" companyId={companyId} label="Export" />
          )}
          {companyId && (
            <OpenTaxPeriod
              companyId={companyId}
              fyStartMonth={company?.fyStartMonth ?? 1}
              suggestYear={today.getUTCFullYear()}
            />
          )}
        </div>
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-4">
        <CompanyPicker companies={accessible.map((x) => ({ id: x.id, code: x.code, name: x.name }))} current={companyId} />
      </div>

      {companyId && (
        <div className="mb-5">
          <CorporateTaxTRN companyId={companyId} value={company?.corporateTaxTRN ?? null} />
        </div>
      )}

      {returns.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1 print:hidden">
          {returns.map((r) => (
            <Link
              key={r.id}
              href={`/finance/corporate-tax?c=${companyId}&r=${r.id}`}
              className={
                r.id === current?.id
                  ? "rounded border border-brand-green bg-brand-green/10 px-3 py-1.5 text-sm font-medium text-brand-green-700"
                  : "rounded border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
              }
            >
              {fmt(r.periodFrom)} – {fmt(r.periodTo)}
              {r.status === "Filed" && <span className="ml-1.5 text-xs">✓</span>}
            </Link>
          ))}
        </div>
      )}

      {!current && (
        <div className="card p-10 text-center">
          <Percent className="mx-auto h-8 w-8 text-muted" />
          <h2 className="mt-3 font-semibold text-heading">No tax period open</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Every UAE company files a corporate tax return once a year, covering its financial year, within nine months
            of that year ending. Open the period and this screen takes the profit from your ledger, applies the
            adjustments you list, and shows the tax &mdash; ready to be typed into EmaraTax.
          </p>
        </div>
      )}

      {current && c && filing && (
        <>
          {filing.overdue && (
            <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
              <span className="font-semibold">This return is overdue.</span> It was due on {fmt(filing.due)}, which is{" "}
              {filing.monthsLate === 1 ? "a month" : `${filing.monthsLate} months`} ago. The late-filing penalty alone is
              around {money(filing.estimatedPenalty)} by now, and late payment is charged separately.
            </div>
          )}
          {!filing.overdue && filing.dueSoon && (
            <div className="mb-5 rounded-lg border border-brand-blue/40 bg-brand-blue/5 px-4 py-3 text-sm text-ink">
              <span className="font-semibold">Due in {filing.daysRemaining} days</span> &mdash; the return and the
              payment are both due by {fmt(filing.due)}.
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className={card}>
              <div className="text-sm text-muted">Revenue</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(c.revenue)}</div>
              <div className="mt-0.5 text-xs text-muted">from the ledger, this period</div>
            </div>
            <div className={card}>
              <div className="text-sm text-muted">Accounting profit</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(c.accountingProfit)}</div>
              <div className="mt-0.5 text-xs text-muted">before any tax adjustment</div>
            </div>
            <div className={card}>
              <div className="text-sm text-muted">Taxable income</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(c.taxableIncome)}</div>
              <div className="mt-0.5 text-xs text-muted">after adjustments and losses</div>
            </div>
            <div className={`${card} ${c.taxPayable > 0 ? "border-brand-gold/40" : ""}`}>
              <div className="text-sm text-muted">Tax payable</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${c.taxPayable > 0 ? "text-brand-gold" : "text-brand-green-700"}`}>
                {money(c.taxPayable)}
              </div>
              <div className="mt-0.5 text-xs text-muted">due by {fmt(filing.due)}</div>
            </div>
          </div>

          {c.sbrApplied && (
            <div className="mb-5 rounded-lg border border-brand-green/40 bg-brand-green/5 px-4 py-3 text-sm text-ink">
              <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-brand-green-700" />
              <span className="font-semibold">Small Business Relief is claimed on this return.</span> The company is
              treated as having no taxable income, so no tax is due. Without it the charge would have been{" "}
              {money(c.taxWithoutSbr)}. The return still has to be filed.
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-5">
            {/* ------------------------------------------------ the computation */}
            <div className="card lg:col-span-3">
              <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                <Percent className="h-5 w-5 text-heading" />
                <h2 className="font-semibold text-heading">The computation</h2>
                <span className="ml-auto text-xs text-muted">
                  {fmt(current.periodFrom)} – {fmt(current.periodTo)}
                </span>
              </div>

              <Row label="Revenue" amount={c.revenue} hint="Total income for the period" muted />
              <Row label="Less: expenses" amount={-(c.revenue - c.accountingProfit)} muted />
              <Row label="Accounting profit" amount={c.accountingProfit} bold rule />

              <Row
                label="Add: disallowed items"
                amount={c.addBacks}
                hint="Costs the accounts took that the tax law will not allow"
                rule
              />
              <Row label="Less: further deductions" amount={-c.deductions} hint="Costs the tax law allows that the accounts did not take" />
              <Row label="Less: exempt income" amount={-c.exemptIncome} hint="Income corporate tax does not charge" />
              <Row label="Taxable income before losses" amount={c.adjustedProfit} bold rule />

              <Row
                label="Less: losses brought forward"
                amount={-c.lossRelief}
                hint={
                  c.lossesBroughtForward > 0
                    ? `${money(c.lossesBroughtForward)} available; at most ${Math.round(LOSS_RELIEF_CAP * 100)}% of taxable income (${money(c.lossReliefCap)}) can be used this year`
                    : "None carried in from earlier years"
                }
                rule
              />
              <Row label="Taxable income" amount={c.taxableIncome} bold rule />

              <Row
                label={`First AED ${CT_BAND.toLocaleString("en-AE")} at 0%`}
                amount={0}
                hint={`${money(c.bandUsed)} of the band used`}
                rule
              />
              <Row
                label={`Remainder at ${Math.round(CT_RATE * 100)}%`}
                amount={c.taxWithoutSbr}
                hint={`${money(c.chargeable)} charged at ${Math.round(CT_RATE * 100)}%`}
              />
              {c.sbrApplied && (
                <Row label="Less: Small Business Relief" amount={-c.taxWithoutSbr} hint="Treated as having no taxable income" />
              )}
              <div className="flex items-center justify-between gap-4 border-t-2 border-heading/20 bg-brand-paper px-5 py-3">
                <div className="font-semibold text-heading">Corporate tax payable</div>
                <div className="text-lg font-bold tabular-nums text-heading">{money(c.taxPayable)}</div>
              </div>

              {c.lossesCarriedForward > 0 && (
                <p className="border-t border-line px-5 py-3 text-xs text-muted">
                  {money(c.lossesCarriedForward)} of losses carries forward to next year. Losses carry forward for as
                  long as it takes, so nothing is lost &mdash; it simply waits.
                </p>
              )}
            </div>

            {/* ------------------------------------------------- the adjustments */}
            <div className="lg:col-span-2">
              <div className="card overflow-x-auto">
                <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                  <h2 className="font-semibold text-heading">Adjustments</h2>
                  <span className="ml-auto text-xs text-muted">{current.adjustments.length}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {current.adjustments.length === 0 && (
                      <tr>
                        <td className="px-5 py-8 text-center text-sm text-muted">
                          Nothing adjusted yet. Most companies have at least fines and entertainment.
                        </td>
                      </tr>
                    )}
                    {current.adjustments.map((a) => (
                      <tr key={a.id}>
                        <td className="px-5 py-2.5">
                          <div className="text-ink">{a.label}</div>
                          <div className="text-xs text-muted">
                            {a.kind}
                            {a.notes ? ` · ${a.notes}` : ""}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink">
                          {a.kind === "Add back" ? "" : "−"}
                          {money(a.amount)}
                        </td>
                        <td className="w-10 px-3 py-2.5 text-right print:hidden">
                          {current.status !== "Filed" && (
                            <GuardedDelete
                              screen="finance.corptax"
                              action={deleteAdjustment.bind(null, a.id)}
                              label={`Remove ${a.label} from the computation?`}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {current.status !== "Filed" && (
                  <div className="border-t border-line px-5 py-3 print:hidden">
                    <AdjustmentForm returnId={current.id} />
                  </div>
                )}
              </div>

              <div className="card mt-5 p-5 print:hidden">
                <div className="mb-3 text-sm font-semibold text-heading">This return</div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted">Status</dt>
                    <dd className="text-ink">{current.status}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Due</dt>
                    <dd className={filing.overdue ? "font-medium text-brand-gold" : "text-ink"}>{fmt(filing.due)}</dd>
                  </div>
                  {current.filedRef && (
                    <div className="flex justify-between">
                      <dt className="text-muted">EmaraTax reference</dt>
                      <dd className="font-mono text-ink">{current.filedRef}</dd>
                    </div>
                  )}
                  {current.filedOn && (
                    <div className="flex justify-between">
                      <dt className="text-muted">Filed on</dt>
                      <dd className="text-ink">{fmt(current.filedOn)}</dd>
                    </div>
                  )}
                  {current.notes && <p className="pt-1 text-muted">{current.notes}</p>}
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <TaxReturnSettings
                    id={current.id}
                    lossesBroughtForward={current.lossesBroughtForward}
                    sbrElected={current.sbrElected}
                    notes={current.notes}
                    sbrEligible={c.sbrEligible}
                    sbrReason={c.sbrReason}
                    taxWithoutSbr={c.taxWithoutSbr}
                    disabled={current.status === "Filed"}
                  />
                  <FileTaxReturn
                    id={current.id}
                    status={current.status}
                    taxPayable={c.taxPayable}
                    filedRef={current.filedRef}
                  />
                  {current.status !== "Filed" && (
                    <GuardedDelete
                      screen="finance.corptax"
                      action={deleteReturn.bind(null, current.id)}
                      label={`Delete the draft return for ${fmt(current.periodFrom)} – ${fmt(current.periodTo)}?`}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {!company?.corporateTaxTRN && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-brand-paper px-4 py-3 text-sm text-muted print:hidden">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                No corporate tax registration number recorded for {companyName}. It is a different number from the VAT
                TRN, and the return asks for it &mdash; add it above so it is not hunted for on filing day.
              </span>
            </div>
          )}

          <p className="mt-4 text-xs text-muted">
            This is a working paper, not a filing. The return itself is submitted to the FTA through EmaraTax, by a
            person. What this does is take the profit from your own books, apply the adjustments you have listed, and
            show the arithmetic &mdash; so the figure you type into EmaraTax can be traced back to the vouchers behind
            it. Print it and keep it with the filing.
          </p>
        </>
      )}
    </div>
  );
}
