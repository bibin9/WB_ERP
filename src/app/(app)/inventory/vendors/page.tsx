import Link from "next/link";
import { Gauge } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { ratingsFor } from "@/lib/vendorrating-data";
import { MIN_HISTORY, vendorVerdict } from "@/lib/vendorrating";

export const dynamic = "force-dynamic";

const asPct = (n: number) => `${Math.round(n * 100)}%`;

/** Shown when there is not enough behind a figure to stand behind it. */
function TooFew({ have }: { have: number }) {
  return (
    <span className="text-muted/60" title={`${have} is below the ${MIN_HISTORY} needed before this means anything`}>
      {have === 0 ? "—" : `${have} so far`}
    </span>
  );
}

/**
 * How suppliers have actually performed (INV-21).
 *
 * Four measures side by side and no combined score, for the same reason the
 * bid comparison has none: the weights would be invented. Each figure carries
 * the count it is out of, and below MIN_HISTORY it is not shown at all — a
 * supplier with one late order is not "0% on time" in any sense worth acting
 * on, and a table that prints it next to a supplier with forty orders at 0%
 * invites somebody to treat them the same.
 */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("inventory.vendors");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const where = {
    companyId,
    type: { not: "Customer" },
    ...(matchAny(term, ["name", "code"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.party.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const suppliers = companyId
    ? await db.party.findMany({
        where,
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, isActive: true },
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const ratings = companyId ? await ratingsFor(companyId, suppliers.map((s) => s.id)) : {};

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Supplier Performance" />

      <PageHeader
        title="Supplier Performance"
        subtitle="Read back out of what actually happened. Nothing here is typed in by anybody."
      >
        <PrintReport />
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <div className="mb-4">
        <SearchBox placeholder="Search supplier name or code" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Supplier</th>
              <th className="px-4 py-2.5 text-right font-medium">On time in full</th>
              <th className="px-4 py-2.5 text-right font-medium">Rejected</th>
              <th className="px-4 py-2.5 text-right font-medium">Replies to enquiries</th>
              <th className="px-4 py-2.5 text-right font-medium">Cheapest</th>
              <th className="px-4 py-2.5 font-medium">In a sentence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term ? (
                    <>
                      No suppliers on this company yet. Add them on{" "}
                      <Link href="/finance/parties" className="underline">Parties</Link>.
                    </>
                  ) : (
                    "Nothing matches."
                  )}
                </td>
              </tr>
            )}
            {suppliers.map((s) => {
              const r = ratings[s.id];
              return (
                <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                  <td className="px-4 py-2.5">
                    <span className="text-ink">{s.name}</span>
                    <div className="font-mono text-xs text-muted">{s.code}</div>
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r?.delivery.enough ? (
                      <>
                        <span className={r.delivery.otifRate < 0.8 ? "text-brand-gold" : "text-ink"}>
                          {asPct(r.delivery.otifRate)}
                        </span>
                        <div className="text-xs text-muted">of {r.delivery.considered} orders</div>
                        {r.delivery.undated > 0 && (
                          <div
                            className="text-xs text-muted/60"
                            title="An order with no promised date cannot be judged late, so it is left out rather than counted as on time"
                          >
                            {r.delivery.undated} undated
                          </div>
                        )}
                      </>
                    ) : (
                      <TooFew have={r?.delivery.considered ?? 0} />
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r?.quality.enough ? (
                      <>
                        <span className={r.quality.defectRate > 0 ? "text-brand-gold" : "text-ink"}>
                          {asPct(r.quality.defectRate)}
                        </span>
                        <div className="text-xs text-muted">of {r.quality.inspected} inspected</div>
                      </>
                    ) : (
                      <TooFew have={r?.quality.inspected ?? 0} />
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r?.response.enough ? (
                      <>
                        <span className={r.response.replyRate < 0.5 ? "text-brand-gold" : "text-ink"}>
                          {r.response.replied}/{r.response.asked}
                        </span>
                        <div className="text-xs text-muted">
                          {r.response.medianDays == null ? "never replied" : `typically ${r.response.medianDays}d`}
                        </div>
                      </>
                    ) : (
                      <TooFew have={r?.response.asked ?? 0} />
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r?.price.enough ? (
                      <>
                        <span className="text-ink">{r.price.timesLowest}/{r.price.compared}</span>
                        <div className="text-xs text-muted">
                          {r.price.averageAboveLowest > 0
                            ? `+${asPct(r.price.averageAboveLowest)} on average`
                            : "always lowest"}
                        </div>
                      </>
                    ) : (
                      <TooFew have={r?.price.compared ?? 0} />
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-xs text-muted">
                    {r ? vendorVerdict(r) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="suppliers" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Gauge className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Nothing on this page is typed in. On time in full comes from purchase orders against the dates the
          supplier promised; rejections from QA/QC inspections; replies from enquiries they were asked to price.
          A rating somebody enters by hand is a rating of the last conversation they had, and it is always five
          stars for whoever they like. Every figure carries the count it is out of, and below {MIN_HISTORY} it is
          not shown at all &mdash; a supplier with one late order is not &ldquo;0% on time&rdquo; in any sense
          worth acting on, and dropping a supplier over a sample of one is usually irreversible, because nobody
          re-approves a vendor somebody else blacklisted. There is deliberately no overall score: combining
          on-time delivery with defect rate would need weights nobody agreed, and a number that looks objective
          while being invented is worse than none.
        </p>
      </div>
    </div>
  );
}
