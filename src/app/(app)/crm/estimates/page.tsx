import Link from "next/link";
import { Calculator } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import CrmTabs from "@/components/CrmTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import EstimateForm from "@/components/crm/EstimateForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { priceEstimate, ESTIMATE_STATUS_HELP } from "@/lib/estimate-posting";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const statusTone: Record<string, string> = {
  Draft: "bg-line text-muted",
  Priced: "bg-brand-blue/10 text-brand-blue-600",
  Quoted: "bg-brand-green/10 text-brand-green-700",
  Superseded: "bg-line text-muted",
};

/**
 * Every estimate, with what each one actually returns.
 *
 * Margin and markup side by side in every row, because a list that shows one
 * percentage is a list somebody will read as the other.
 */
export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("crm.estimates");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const where = { companyId, ...(matchAny(term, ["number", "title", "preparedBy"]) ?? {}) };
  const paging = readPaging(sp);
  const total = companyId ? await db.estimate.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const rows = companyId
    ? await db.estimate.findMany({
        where,
        include: {
          lead: { select: { id: true, number: true, customerName: true } },
          lines: { include: { takeoffs: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const leads = companyId
    ? await db.lead.findMany({
        where: { companyId, stage: { notIn: ["Won", "Lost"] } },
        orderBy: { number: "desc" },
        select: { id: true, number: true, title: true, customerName: true },
        take: 100,
      })
    : [];

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Estimates" />

      <PageHeader
        title="Estimates"
        subtitle="What the work costs, built up rather than guessed at."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <EstimateForm companyId={companyId} leads={leads} />}
        </div>
      </PageHeader>
      <CrmTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <div className="mb-4">
        <SearchBox placeholder="Search estimate number, title or who priced it" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Estimate</th>
              <th className="px-4 py-2.5 font-medium">For</th>
              <th className="px-4 py-2.5 text-right font-medium">Lines</th>
              <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Quote</th>
              <th className="px-4 py-2.5 text-right font-medium">Margin &amp; markup</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {term ? "Nothing matches." : "No estimates yet. Start one when an enquiry needs pricing."}
                </td>
              </tr>
            )}
            {rows.map((e) => {
              const t = priceEstimate(e);
              return (
                <tr key={e.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/crm/estimates/${e.id}`} className="font-mono text-xs text-brand-blue-600 hover:underline">
                      {e.number}
                    </Link>
                    <div className="text-xs text-muted">{e.title}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {e.lead ? (
                      <>
                        <span className="text-ink">{e.lead.customerName}</span>
                        <div className="font-mono text-muted">{e.lead.number}</div>
                      </>
                    ) : (
                      <span className="text-muted">No enquiry</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{t.lines || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(t.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(t.sell)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {t.cost > 0 ? (
                      <>
                        <span className={t.profit < 0 ? "text-brand-gold" : "text-ink"}>{pct(t.margin)}</span>
                        <div className="text-muted">{pct(t.markup)} markup</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span
                      title={ESTIMATE_STATUS_HELP[e.status]}
                      className={`rounded px-1.5 py-0.5 ${statusTone[e.status] ?? "bg-line text-muted"}`}
                    >
                      {e.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="estimates" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Margin and markup are shown together in every row because a list showing one of them is a list somebody
          will read as the other. A 20% markup is a 16.7% margin, and on a two million dirham job the difference
          is sixty-seven thousand dirhams of profit that was never there. Nothing in this table is stored: every
          figure is built up from the lines when the page is opened, because an estimate is edited twenty times
          before it goes out and a stored total is one that was true when somebody last pressed save.
        </p>
      </div>
    </div>
  );
}
