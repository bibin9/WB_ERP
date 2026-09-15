import Link from "next/link";
import { FileSignature } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import CrmTabs from "@/components/CrmTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import QuoteTracker from "@/components/crm/QuoteTracker";
import QuotationForm from "@/components/crm/QuotationForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { syncQuoteApproval } from "@/lib/quote-posting";
import { QUOTE_STATUS_HELP, summariseQuotes, quotesVerdict, poVariance } from "@/lib/quoting";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const tone: Record<string, string> = {
  Draft: "bg-line text-muted",
  "Awaiting approval": "bg-brand-gold/10 text-brand-gold",
  Approved: "bg-brand-blue/10 text-brand-blue-600",
  Issued: "bg-brand-blue/10 text-brand-blue-600",
  Accepted: "bg-brand-green/10 text-brand-green-700",
  Declined: "bg-line text-muted",
  Superseded: "bg-line text-muted",
};

/**
 * Every quotation, and what happened to it (CRM-13 to CRM-17).
 *
 * The hit rate is by VALUE rather than by count, because winning three small
 * ones and losing the large one is not a good quarter, and a rate by count
 * would report it as one.
 */
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("crm.quotations");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  // Mirror any approvals decided since this page was last opened.
  if (companyId) {
    const waiting = await db.quotation.findMany({
      where: { companyId, status: "Awaiting approval" },
      select: { id: true },
    });
    for (const q of waiting) await syncQuoteApproval(q.id);
  }

  const term = readSearch(sp);
  const where = { companyId, ...(matchAny(term, ["number", "title", "customerName", "poNumber"]) ?? {}) };
  const paging = readPaging(sp);
  const total = companyId ? await db.quotation.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const rows = companyId
    ? await db.quotation.findMany({
        where,
        include: { job: { select: { code: true } }, lead: { select: { id: true, number: true } } },
        orderBy: { createdAt: "desc" },
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const all = companyId
    ? await db.quotation.findMany({ where: { companyId }, select: { status: true, total: true, poValue: true } })
    : [];
  const totals = summariseQuotes(all.map((q) => ({ status: q.status, total: q.total, orderedValue: q.poValue })));

  /** Estimates that are priced and have nothing out against them yet. */
  const estimates = companyId
    ? await db.estimate.findMany({
        where: { companyId, status: { in: ["Draft", "Priced"] } },
        include: { lead: { select: { customerName: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Quotations" />

      <PageHeader title="Quotations" subtitle={quotesVerdict(totals)}>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && (
            <QuotationForm
              companyId={companyId}
              estimates={estimates.map((e) => ({
                id: e.id, number: e.number, title: e.title,
                customerName: e.lead?.customerName ?? "",
              }))}
            />
          )}
        </div>
      </PageHeader>
      <CrmTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Out with customers</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{money(totals.outstandingValue)}</div>
          <div className="text-xs text-muted">
            {totals.outstanding} {totals.outstanding === 1 ? "quotation" : "quotations"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Won</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-green-700">{money(totals.acceptedValue)}</div>
          <div className="text-xs text-muted">{totals.accepted} ordered</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Lost</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{money(totals.declinedValue)}</div>
          <div className="text-xs text-muted">{totals.declined} declined</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Hit rate by value</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">
            {totals.decided >= 3 ? `${Math.round(totals.hitRate * 100)}%` : "—"}
          </div>
          <div className="text-xs text-muted">
            {totals.decided >= 3 ? `of ${totals.decided} decided` : `${totals.decided} decided — too few to call`}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <SearchBox placeholder="Search quotation, customer or their order number" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Quotation</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 text-right font-medium">Quoted</th>
              <th className="px-4 py-2.5 text-right font-medium">They ordered</th>
              <th className="w-56 px-4 py-2.5 font-medium">Where it got to</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {term ? "Nothing matches." : "No quotations yet. Raise one from a priced estimate."}
                </td>
              </tr>
            )}
            {rows.map((q) => {
              const v = q.poValue != null ? poVariance(q.total, q.poValue) : null;
              return (
                <tr key={q.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/crm/quotations/${q.id}`} className="font-mono text-xs text-brand-blue-600 hover:underline">
                      {q.number}
                    </Link>
                    {q.revision > 1 && <span className="ml-1 text-xs text-muted">rev {q.revision}</span>}
                    <div className="text-xs text-muted">{q.title}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="text-ink">{q.customerName}</span>
                    {q.job && <div className="font-mono text-muted">job {q.job.code}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(q.total)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {v ? (
                      <>
                        <span className="tabular-nums text-ink">{money(v.ordered)}</span>
                        {!v.matches && (
                          <div className={v.difference > 0 ? "text-brand-green-700" : "text-brand-gold"}>
                            {v.difference > 0 ? "+" : "−"}{money(Math.abs(v.difference))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <QuoteTracker status={q.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span
                      title={QUOTE_STATUS_HELP[q.status]}
                      className={`rounded px-1.5 py-0.5 ${tone[q.status] ?? "bg-line text-muted"}`}
                    >
                      {q.status}
                    </span>
                    <div className="mt-0.5 text-muted">{fmt(q.issuedAt ?? q.createdAt)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="quotations" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          The hit rate is by value rather than by count, because winning three small quotations and losing the
          large one is not a good quarter and a rate by count would report it as one. Where a customer ordered a
          different figure from the one quoted, the difference is shown &mdash; the job was created at{" "}
          <span className="font-medium">their</span> figure, which is what every margin report on that contract
          then measures against.
        </p>
      </div>
    </div>
  );
}
