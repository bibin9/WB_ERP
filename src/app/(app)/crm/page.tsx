import Link from "next/link";
import { TrendingUp } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import Pager from "@/components/Pager";
import { readPaging, pageInfo } from "@/lib/paging";
import CompanyPicker from "@/components/CompanyPicker";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import CrmTabs from "@/components/CrmTabs";
import LeadForm from "@/components/crm/LeadForm";
import PipelineFunnel from "@/components/crm/PipelineFunnel";
import QualificationDots from "@/components/crm/QualificationDots";
import StageTracker from "@/components/crm/StageTracker";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readSearch, matchAny } from "@/lib/search";
import { toLeadLike } from "@/lib/lead-posting";
import {
  LEAD_STAGES, STAGE_HELP, CLOSED_STAGES, stageProbability,
  siteReportSubmitted, weightedValue, summarisePipeline, pipelineVerdict,
} from "@/lib/leads";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** The stages that are still in play, in the order work moves through them. */
const OPEN_STAGES = LEAD_STAGES.filter((s) => !CLOSED_STAGES.has(s));

/**
 * The pipeline board (CRM-01, CRM-02, CRM-11, CRM-12).
 *
 * A column per stage, because the question a sales manager actually asks is
 * "what is stuck where" and a flat list cannot answer it. Each column carries
 * its own weighted total, so moving a card has a visible consequence — which
 * is what makes moving one worth arguing about.
 *
 * The figure at the top is the weighted one. The gross is shown beside it in
 * smaller type on purpose: the gross is the number people quote and the
 * weighted one is the number that is true.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; show?: string; p?: string; per?: string }>;
}) {
  await requireAccess("crm.leads");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const showClosed = sp.show === "all";

  // The board shows what is open — as many columns as there are stages, and
  // an open deal is worked on, so the count is bounded by what the business
  // can actually chase. Closed deals are the ones that accumulate for ever,
  // so those are paged.
  const openWhere = {
    companyId,
    stage: { notIn: ["Won", "Lost"] },
    ...(matchAny(term, ["number", "title", "customerName", "ownerName"]) ?? {}),
  };
  const closedWhere = {
    companyId,
    stage: { in: ["Won", "Lost"] },
    ...(matchAny(term, ["number", "title", "customerName", "ownerName"]) ?? {}),
  };

  const paging = readPaging(sp);
  const closedTotal = companyId && showClosed ? await db.lead.count({ where: closedWhere }) : 0;
  const info = pageInfo(paging, closedTotal);

  const [openRows, closedRows] = companyId
    ? await Promise.all([
        db.lead.findMany({
          where: openWhere,
          include: { visits: { select: { reportOn: true } } },
          orderBy: [{ estimatedValue: "desc" }],
        }),
        showClosed
          ? db.lead.findMany({
              where: closedWhere,
              include: { visits: { select: { reportOn: true } } },
              orderBy: [{ closedAt: "desc" }],
              skip: (info.page - 1) * info.perPage,
              take: info.perPage,
            })
          : Promise.resolve([]),
      ])
    : [[], []];
  const rows = [...openRows, ...closedRows];

  /** Everything, closed included, so the win rate has something to work from. */
  const all = companyId
    ? await db.lead.findMany({
        where: { companyId },
        include: { visits: { select: { reportOn: true } } },
      })
    : [];
  const shaped = all.map(toLeadLike);
  const totals = summarisePipeline(shaped);
  const verdict = pipelineVerdict(shaped);

  const parties = companyId
    ? await db.party.findMany({
        where: { companyId, isActive: true, type: { not: "Supplier" } },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  const byStage = (stage: string) => rows.filter((l) => l.stage === stage);

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Sales Pipeline" />

      <PageHeader title="CRM &amp; Estimation" subtitle={verdict}>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <LeadForm companyId={companyId} parties={parties} />}
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
          <div className="text-xs uppercase tracking-wide text-muted">Weighted pipeline</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{money(totals.weighted)}</div>
          <div className="text-xs text-muted">against {money(totals.gross)} gross</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Open enquiries</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{totals.open}</div>
          <div className="text-xs text-muted">won and lost are not pipeline</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Won</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-green-700">{money(totals.wonValue)}</div>
          <div className="text-xs text-muted">
            {totals.won} {totals.won === 1 ? "enquiry" : "enquiries"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Win rate</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">
            {totals.decided >= 5 ? `${Math.round(totals.winRate * 100)}%` : "—"}
          </div>
          <div className="text-xs text-muted">
            {totals.decided >= 5
              ? `of ${totals.decided} decided`
              : `${totals.decided} decided — too few to call`}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <SearchBox placeholder="Search enquiry, customer or who is chasing it" />
        </div>
        <div className="flex items-center gap-1 text-sm print:hidden">
          <Link
            href={`/crm?c=${companyId}`}
            className={`rounded px-2 py-1 ${!showClosed ? "bg-line font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            Open
          </Link>
          <Link
            href={`/crm?c=${companyId}&show=all`}
            className={`rounded px-2 py-1 ${showClosed ? "bg-line font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            All
          </Link>
        </div>
      </div>

      {companyId && (
        <div className="card mb-5 p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Where the work is sitting
          </h2>
          <PipelineFunnel byStage={totals.byStage} />
        </div>
      )}

      {companyId && rows.length === 0 && (
        <div className="card px-4 py-10 text-center text-muted">
          {term
            ? "Nothing matches."
            : "No enquiries yet. Log one when a customer asks for a price."}
        </div>
      )}

      {/* ==================================================== the board == */}
      <div className="overflow-x-auto">
        <div className="flex gap-3" style={{ minWidth: `${OPEN_STAGES.length * 240}px` }}>
          {OPEN_STAGES.map((stage) => {
            const cards = byStage(stage);
            const weighted = cards.reduce((s, l) => s + weightedValue(toLeadLike(l)), 0);
            return (
              <div key={stage} className="flex-1">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted" title={STAGE_HELP[stage]}>
                    {stage}
                  </span>
                  <span className="text-xs text-muted">{Math.round(stageProbability(stage) * 100)}%</span>
                </div>
                <div className="mb-2 px-1 text-sm tabular-nums text-ink">
                  {money(weighted)}
                  <span className="ml-1 text-xs text-muted">
                    {cards.length} {cards.length === 1 ? "enquiry" : "enquiries"}
                  </span>
                </div>

                <div className="space-y-2">
                  {cards.length === 0 && (
                    <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                      Nothing here
                    </div>
                  )}
                  {cards.map((l) => {
                    const shape = toLeadLike(l);
                    return (
                      <Link
                        key={l.id}
                        href={`/crm/${l.id}`}
                        className="block rounded-lg border border-line bg-surface p-3 hover:border-brand-blue-600"
                      >
                        <div className="font-mono text-xs text-muted">{l.number}</div>
                        <div className="mt-0.5 text-sm font-medium text-heading">{l.title}</div>
                        <div className="text-xs text-muted">{l.customerName}</div>

                        <div className="mt-2 flex items-baseline justify-between">
                          <span className="text-sm tabular-nums text-ink">{money(l.estimatedValue)}</span>
                          <span className="text-xs tabular-nums text-muted">
                            {money(weightedValue(shape))} wtd
                          </span>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-1.5">
                          <QualificationDots lead={shape} />
                          {siteReportSubmitted(shape) && (
                            <span
                              className="rounded bg-brand-green/10 px-1.5 py-0.5 text-xs text-brand-green-700"
                              title="A site visit report has been filed"
                            >
                              Site report
                            </span>
                          )}
                        </div>

                        {l.requiredBy && (
                          <div className="mt-1.5 text-xs text-muted">Needed by {fmt(l.requiredBy)}</div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showClosed && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Decided</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Enquiry</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 font-medium">How far it got</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {closedRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">Nothing decided yet.</td>
                  </tr>
                )}
                {closedRows.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/crm/${l.id}`} className="font-mono text-xs text-brand-blue-600 hover:underline">
                        {l.number}
                      </Link>
                      <div className="text-xs text-muted">{l.title}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink">{l.customerName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(l.estimatedValue)}</td>
                    <td className="w-64 px-4 py-2.5">
                      <StageTracker stage={l.stage} closedFrom={l.closedFromStage} compact />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          l.stage === "Won"
                            ? "bg-brand-green/10 text-brand-green-700"
                            : "bg-line text-muted"
                        }`}
                      >
                        {l.stage}
                      </span>
                      <div className="mt-0.5 text-muted">{fmt(l.closedAt)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {l.stage === "Lost" ? (
                        <>
                          {l.lostReason}
                          {l.lostTo && <div className="text-ink">Won by {l.lostTo}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Pager info={info} label="decided enquiries" />
          </div>
        </div>
      )}

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          The headline figure is the weighted one, and the gross sits beside it in smaller type on purpose: the
          gross is the number people quote and the weighted one is the number that is true. A deal&rsquo;s
          probability comes from the stage it has reached, never from a box somebody fills in &mdash; typed per
          deal, every deal is ninety per cent and the weighted total is the gross total with extra steps. Won and
          lost enquiries leave the pipeline entirely: a won deal is revenue and belongs on a job, a lost one is
          nothing, and a forecast that keeps either only ever goes up. The <span className="font-medium">known</span>{" "}
          badge counts how many of five questions have an answer &mdash; budget, decision-maker, date needed, site
          visited, scope defined. A low score is not a bad enquiry; it is one nobody has done the work on yet,
          which is something a sales manager can actually act on.
        </p>
      </div>
    </div>
  );
}
