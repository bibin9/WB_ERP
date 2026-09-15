import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calculator } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import PrintReport from "@/components/finance/PrintReport";
import GuardedDelete from "@/components/GuardedDelete";
import CostBar from "@/components/crm/CostBar";
import EstimateLineForm from "@/components/crm/EstimateLineForm";
import TakeoffForm from "@/components/crm/TakeoffForm";
import BasisForm from "@/components/crm/BasisForm";
import FinishEstimate from "@/components/crm/FinishEstimate";
import { deleteEstimateLine, deleteTakeoffLine } from "../actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { estimateWithTotals } from "@/lib/estimate-posting";
import { ESTIMATE_STATUS_HELP } from "@/lib/estimate-posting";
import { bidLine, isLumpSum, takeoff, estimateVerdict, checkQuotable } from "@/lib/estimating";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Building an estimate (CRM-05, CRM-06, CRM-07).
 *
 * The bar at the top is the page. Material, labour, plant and subcontract,
 * then the overhead, then what is left as profit — in the order the money is
 * added, so the gold band is visibly sitting inside the price rather than
 * eating the green one.
 *
 * Both percentages are shown side by side wherever a percentage appears, which
 * is the only reliable cure for the markup-and-margin confusion: somebody
 * reading "16.7% margin, 20.0% markup" cannot make the mistake.
 */
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("crm.estimates");
  const session = await getSession();
  const { id } = await params;

  const held = await estimateWithTotals(id);
  if (!held) notFound();
  const { estimate, totals } = held;

  const accessible = session?.companies ?? [];
  if (!accessible.some((c) => c.id === estimate.companyId)) notFound();
  const company = await db.company.findUnique({ where: { id: estimate.companyId } });

  const editable = estimate.status === "Draft" || estimate.status === "Priced";
  const fit = checkQuotable(totals, estimate.acceptLoss);

  const items = await db.item.findMany({
    where: { companyId: estimate.companyId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, unitCode: true, standardCost: true },
  });

  return (
    <div>
      <PrintHeader companyName={company?.name ?? ""} logoUrl={company?.logoUrl} title={`Estimate — ${estimate.number}`} />

      <div className="mb-3 print:hidden">
        <Link href="/crm/estimates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All estimates
        </Link>
      </div>

      <PageHeader title={estimate.title} subtitle={estimateVerdict(totals)}>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {editable && <BasisForm estimate={estimate} totals={totals} />}
          {estimate.status === "Draft" && <FinishEstimate estimateId={estimate.id} blocked={!fit.ok} />}
        </div>
      </PageHeader>

      {/* ============================================ where the money is == */}
      <div className="card mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Quote</div>
            <div className="text-3xl font-semibold tabular-nums text-heading">{money(totals.sell)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted">Profit</div>
            <div
              className={`text-2xl font-semibold tabular-nums ${
                totals.profit > 0 ? "text-brand-green-700" : totals.profit < 0 ? "text-brand-gold" : "text-ink"
              }`}
            >
              {money(totals.profit)}
            </div>
            <div className="text-xs text-muted">
              <span className="font-medium text-ink">{pct(totals.margin)} margin</span>
              {" · "}
              {pct(totals.markup)} markup
            </div>
          </div>
        </div>

        <CostBar totals={totals} />

        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Priced on a <span className="font-medium text-ink">{estimate.basisKind}</span> of{" "}
          {pct(estimate.basisValue)}. A 20% markup is a 16.7% margin — they are different numbers, so both are
          shown wherever either appears. Overhead goes on the direct cost <span className="font-medium">before</span>{" "}
          the margin; the other way round and the overhead comes straight back out of the profit.
        </p>
      </div>

      {!fit.ok && estimate.status === "Draft" && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Not ready to quote from.</span> {fit.error}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Direct cost</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-heading">{money(totals.direct)}</div>
          <div className="text-xs text-muted">{totals.lines} line{totals.lines === 1 ? "" : "s"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Overhead</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-heading">{money(totals.indirect)}</div>
          <div className="text-xs text-muted">
            {pct(estimate.overheadPct)} of direct{estimate.fixedCosts > 0 && ` + ${money(estimate.fixedCosts)} fixed`}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">What it costs</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-heading">{money(totals.cost)}</div>
          <div className="text-xs text-muted">direct plus overhead</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Status</div>
          <div className="mt-1 text-lg font-semibold text-heading">{estimate.status}</div>
          <div className="text-xs text-muted">{ESTIMATE_STATUS_HELP[estimate.status]}</div>
        </div>
      </div>

      {estimate.lead && (
        <div className="mb-5 text-xs text-muted">
          Pricing enquiry{" "}
          <Link href={`/crm/${estimate.lead.id}`} className="underline">{estimate.lead.number}</Link>{" "}
          for {estimate.lead.customerName}.
        </div>
      )}

      {/* ================================================ the priced BOQ == */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Bill of quantities</h2>
        {editable && <EstimateLineForm estimateId={estimate.id} />}
      </div>

      <div className="space-y-3">
        {estimate.lines.length === 0 && (
          <div className="card px-4 py-10 text-center text-muted">
            Nothing priced yet. Add the first item from the bill of quantities.
          </div>
        )}

        {estimate.lines.map((l) => {
          const priced = bidLine({
            unit: l.unit,
            quantity: l.quantity,
            build: {
              materialCost: l.takeoffs.length
                ? l.takeoffs.reduce((s, t) => s + t.perUnit * (1 + t.wastage) * t.unitCost, 0)
                : l.materialCost,
              labourHours: l.labourHours, labourRate: l.labourRate,
              plantHours: l.plantHours, plantRate: l.plantRate,
              subcontractCost: l.subcontractCost,
            },
          });
          return (
            <div key={l.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {l.ref && <span className="font-mono text-xs text-muted">{l.ref}</span>}
                    <span className="font-medium text-heading">{l.description}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {isLumpSum(l.unit) ? (
                      <span title="One price for the package — there is no quantity">Lump sum</span>
                    ) : (
                      <>{l.quantity.toLocaleString()} {l.unit.toLowerCase()}</>
                    )}
                    {" · "}
                    {money(priced.unitCost)} each
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="tabular-nums text-ink">{money(priced.cost)}</div>
                    <div className="text-xs text-muted">direct cost</div>
                  </div>
                  {editable && (
                    <div className="flex items-center gap-1 print:hidden">
                      <EstimateLineForm estimateId={estimate.id} row={l} />
                      <GuardedDelete
                        screen="crm.estimates"
                        action={deleteEstimateLine.bind(null, l.id)}
                        label={`Remove "${l.description}" from this estimate?`}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* the build-up, in words rather than a spreadsheet */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-2.5 text-xs sm:grid-cols-4">
                <div>
                  <span className="text-muted">Material </span>
                  <span className="tabular-nums text-ink">{money(priced.build.material)}</span>
                  {l.takeoffs.length > 0 && <span className="ml-1 text-muted">from takeoff</span>}
                </div>
                <div>
                  <span className="text-muted">Labour </span>
                  <span className="tabular-nums text-ink">{money(priced.build.labour)}</span>
                  {l.labourHours > 0 && (
                    <span className="ml-1 text-muted">{l.labourHours}h at {money(l.labourRate)}</span>
                  )}
                </div>
                <div>
                  <span className="text-muted">Plant </span>
                  <span className="tabular-nums text-ink">{money(priced.build.plant)}</span>
                  {l.plantHours > 0 && (
                    <span className="ml-1 text-muted">{l.plantHours}h at {money(l.plantRate)}</span>
                  )}
                </div>
                <div>
                  <span className="text-muted">Subcontract </span>
                  <span className="tabular-nums text-ink">{money(priced.build.subcontract)}</span>
                </div>
              </div>

              {/* ========================================== the takeoff == */}
              <div className="border-t border-line bg-brand-paper/40 px-4 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">
                    What one {isLumpSum(l.unit) ? "package" : l.unit.toLowerCase()} needs
                  </span>
                  {editable && <TakeoffForm lineId={l.id} items={items} />}
                </div>

                {l.takeoffs.length === 0 ? (
                  <p className="text-xs text-muted">
                    No takeoff, so the material figure above is the one entered by hand. That is fine for items
                    nobody is going to measure.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="py-1 font-medium">Material</th>
                        <th className="py-1 text-right font-medium">Per unit</th>
                        <th className="py-1 text-right font-medium">Wastage</th>
                        <th className="py-1 text-right font-medium">To buy</th>
                        <th className="py-1 text-right font-medium">Cost</th>
                        <th className="print:hidden" />
                      </tr>
                    </thead>
                    <tbody>
                      {l.takeoffs.map((t) => {
                        const off = takeoff(priced.quantity, t);
                        return (
                          <tr key={t.id} className="border-t border-line/60">
                            <td className="py-1 text-ink">{t.description}</td>
                            <td className="py-1 text-right tabular-nums text-muted">
                              {t.perUnit.toLocaleString()} {t.unitCode}
                            </td>
                            <td className="py-1 text-right tabular-nums text-muted">
                              {t.wastage > 0 ? pct(t.wastage) : "—"}
                            </td>
                            <td className="py-1 text-right tabular-nums text-ink">
                              {off.gross.toLocaleString()}
                              {off.wasted > 0 && (
                                <span className="ml-1 text-muted" title="Extra bought to cover wastage">
                                  (+{off.wasted.toLocaleString()})
                                </span>
                              )}
                            </td>
                            <td className="py-1 text-right tabular-nums text-ink">{money(off.cost)}</td>
                            <td className="py-1 text-right print:hidden">
                              {editable && (
                                <div className="flex items-center justify-end gap-1">
                                  <TakeoffForm lineId={l.id} items={items} row={t} />
                                  <GuardedDelete
                                    screen="crm.estimates"
                                    action={deleteTakeoffLine.bind(null, t.id)}
                                    label={`Remove "${t.description}" from the takeoff?`}
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          No rate on this page was typed. Every one is built from material, labour hours at a rate, plant hours at
          a rate, and subcontract — because six months later the only question worth asking is why a line is
          losing money, and a rate somebody typed cannot answer it. Where a line has a takeoff, the takeoff{" "}
          <span className="font-medium">is</span> its material cost: two figures meant to agree eventually will
          not, and the one on the screen would be the wrong one. Wastage lives on each takeoff line rather than
          being added at the end, because five per cent on a cable drum is a rounding error and five per cent on
          structural steel is a week of somebody&rsquo;s wages. Nothing here is stored as a total: every figure is
          worked out when the page is opened, because an estimate is edited twenty times before it goes out.
        </p>
      </div>
    </div>
  );
}
