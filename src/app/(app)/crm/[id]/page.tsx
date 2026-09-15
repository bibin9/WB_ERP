import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, MessageSquare, TrendingUp } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import PrintReport from "@/components/finance/PrintReport";
import StageTracker from "@/components/crm/StageTracker";
import QualificationDots from "@/components/crm/QualificationDots";
import StageMover from "@/components/crm/StageMover";
import InteractionForm from "@/components/crm/InteractionForm";
import VisitForm from "@/components/crm/VisitForm";
import ReportForm from "@/components/crm/ReportForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { toLeadLike } from "@/lib/lead-posting";
import {
  CLOSED_STAGES, STAGE_HELP, qualify, siteReportSubmitted, weightedValue, stageProbability, leadVerdict,
} from "@/lib/leads";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stamp = (d: Date) =>
  new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const KIND_TONE: Record<string, string> = {
  Call: "bg-brand-blue/10 text-brand-blue-600",
  Email: "bg-brand-blue/10 text-brand-blue-600",
  Meeting: "bg-brand-green/10 text-brand-green-700",
  "Site visit": "bg-brand-gold/10 text-brand-gold",
  "Quotation sent": "bg-brand-green/10 text-brand-green-700",
  Note: "bg-line text-muted",
};

/**
 * One enquiry, end to end (CRM-01, CRM-02, CRM-11, CRM-12).
 *
 * The tracker across the top is the point of the page. Somebody who has never
 * seen this system should be able to tell where the enquiry is, how far it has
 * come and what is next without reading a word of it — the same way anybody can
 * read a parcel-tracking bar.
 *
 * Below it, the two things that decide whether it goes any further: what is
 * still unknown, and what anybody has actually said to the customer.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("crm.leads");
  const session = await getSession();
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      party: { select: { name: true } },
      job: { select: { id: true, code: true, name: true } },
      visits: { orderBy: { visitedOn: "desc" } },
      interactions: { orderBy: { at: "desc" } },
    },
  });
  if (!lead) notFound();

  const accessible = session?.companies ?? [];
  if (!accessible.some((c) => c.id === lead.companyId)) notFound();
  const company = await db.company.findUnique({ where: { id: lead.companyId } });

  const shape = toLeadLike(lead);
  const q = qualify(shape);
  const open = !CLOSED_STAGES.has(lead.stage);
  const reported = siteReportSubmitted(shape);

  return (
    <div>
      <PrintHeader companyName={company?.name ?? ""} logoUrl={company?.logoUrl} title={`Enquiry — ${lead.number}`} />

      <div className="mb-3 print:hidden">
        <Link href="/crm" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Pipeline
        </Link>
      </div>

      <PageHeader title={lead.title} subtitle={leadVerdict(shape)}>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {open && <StageMover leadId={lead.id} stage={lead.stage} />}
        </div>
      </PageHeader>

      {/* ============================================== the tracker ====== */}
      <div className="card mb-5 px-6 py-5">
        <StageTracker stage={lead.stage} closedFrom={lead.closedFromStage} />
      </div>

      {lead.stage === "Lost" && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Lost</span>
          {lead.lostTo && <> to {lead.lostTo}</>} on {fmt(lead.closedAt)}
          {lead.closedBy && <>, recorded by {lead.closedBy}</>}.
          <div className="mt-1 text-xs">{lead.lostReason}</div>
        </div>
      )}

      {lead.stage === "Won" && (
        <div className="mb-5 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Won</span> on {fmt(lead.closedAt)}
          {lead.closedBy && <> by {lead.closedBy}</>}.{" "}
          {lead.job ? (
            <>It became job <span className="font-mono">{lead.job.code}</span>.</>
          ) : (
            <span className="text-muted">It should be turned into a job.</span>
          )}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Worth</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{money(lead.estimatedValue)}</div>
          <div className="text-xs text-muted">
            {open
              ? `${money(weightedValue(shape))} weighted at ${Math.round(stageProbability(lead.stage) * 100)}%`
              : "not in the forecast"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Customer</div>
          <div className="mt-1 text-sm text-ink">{lead.customerName}</div>
          <div className="text-xs text-muted">
            {lead.party ? "On the customer master" : "Not on the master yet"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Needed by</div>
          <div className="mt-1 text-sm text-ink">{fmt(lead.requiredBy)}</div>
          <div className="text-xs text-muted">{lead.source ?? "source not recorded"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Chased by</div>
          <div className="mt-1 text-sm text-ink">{lead.ownerName}</div>
          <div className="text-xs text-muted">{lead.number}</div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ========================================== what is known ====== */}
        <div className="space-y-5">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">What is known</h2>
              <QualificationDots lead={shape} />
            </div>
            <ul className="space-y-2">
              {q.questions.map((question) => (
                <li key={question.key} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                      question.answered
                        ? "bg-brand-green/15 text-brand-green-700"
                        : "bg-line text-muted"
                    }`}
                  >
                    {question.answered ? "✓" : "?"}
                  </span>
                  <span className={question.answered ? "text-ink" : "text-muted"}>
                    {question.label}
                    {question.key === "budget" && lead.budgetStated != null && (
                      <span className="ml-1 tabular-nums text-muted">{money(lead.budgetStated)}</span>
                    )}
                    {question.key === "decisionMaker" && lead.decisionMaker && (
                      <span className="ml-1 text-muted">{lead.decisionMaker}</span>
                    )}
                    {question.key === "requiredBy" && lead.requiredBy && (
                      <span className="ml-1 text-muted">{fmt(lead.requiredBy)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {q.missing.length > 0 && (
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                A low count is not a bad enquiry &mdash; it is one nobody has done the work on yet.
              </p>
            )}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Contact</h2>
            <div className="space-y-1 text-sm">
              <div className="text-ink">{lead.contactName ?? "Nobody named"}</div>
              {lead.contactEmail && <div className="text-muted">{lead.contactEmail}</div>}
              {lead.contactPhone && <div className="text-muted">{lead.contactPhone}</div>}
            </div>
            {lead.competitors && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-xs uppercase tracking-wide text-muted">Also bidding</div>
                <div className="mt-1 text-sm text-ink">{lead.competitors}</div>
              </div>
            )}
          </div>

          {lead.description && (
            <div className="card p-4">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">What they asked for</h2>
              <p className="whitespace-pre-wrap text-sm text-ink">{lead.description}</p>
            </div>
          )}
        </div>

        {/* ============================================ site visits ====== */}
        <div className="space-y-5">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Site visits</h2>
              {open && <VisitForm leadId={lead.id} />}
            </div>

            <div
              className={`mb-3 rounded px-2 py-1.5 text-xs ${
                reported
                  ? "bg-brand-green/10 text-brand-green-700"
                  : lead.visits.length
                    ? "bg-brand-gold/10 text-brand-gold"
                    : "bg-line text-muted"
              }`}
            >
              {reported
                ? "Site Report Submitted"
                : lead.visits.length
                  ? "Visit recorded — report still to come"
                  : "Nobody has been to site"}
            </div>

            {lead.visits.length === 0 && (
              <p className="text-sm text-muted">
                The report is what an estimate gets built on.
              </p>
            )}

            <ul className="space-y-3">
              {lead.visits.map((v) => (
                <li key={v.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm text-ink">
                        <MapPin className="h-3.5 w-3.5 text-muted" />
                        {fmt(v.visitedOn)}
                      </div>
                      <div className="text-xs text-muted">{v.visitedBy}</div>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        v.reportOn ? "bg-brand-green/10 text-brand-green-700" : "bg-brand-gold/10 text-brand-gold"
                      }`}
                    >
                      {v.reportOn ? "Reported" : "Pending"}
                    </span>
                  </div>
                  {v.findings ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{v.findings}</p>
                  ) : (
                    open && (
                      <div className="mt-2">
                        <ReportForm visitId={v.id} visitedOn={fmt(v.visitedOn)} />
                      </div>
                    )
                  )}
                  {v.reportRef && <p className="mt-1 text-xs text-muted">Report: {v.reportRef}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ============================================== history ======== */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
              Everything that has been said
            </h2>
            {open && <InteractionForm leadId={lead.id} />}
          </div>

          <ol className="space-y-3">
            {lead.interactions.length === 0 && (
              <li className="text-sm text-muted">Nothing recorded yet.</li>
            )}
            {lead.interactions.map((i) => (
              <li key={i.id} className="relative pl-5">
                <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-line" />
                <span className="absolute left-[3px] top-4 h-[calc(100%-0.5rem)] w-px bg-line last:hidden" />
                <div className="flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${KIND_TONE[i.kind] ?? "bg-line text-muted"}`}>
                    {i.kind}
                  </span>
                  <span className="text-xs text-muted">{stamp(i.at)}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{i.summary}</p>
                <p className="text-xs text-muted">{i.by}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          The bar across the top is where this enquiry has got to. A lost enquiry keeps its path and gets a
          different ending, so you can see how far it went before it went &mdash; losing at Negotiating and losing
          at New are different events and should not look the same. The stage sets the probability used in the
          forecast, which is why moving it is a decision rather than housekeeping.{" "}
          <span className="font-medium">Site Report Submitted</span> appears only once a report actually exists,
          never when a visit is merely booked: a status somebody ticks is a status that is wrong the day a visit
          slips. The history below is append-only, because a history that can be edited is one somebody tidies
          before a difficult meeting.
        </p>
      </div>

      <div className="mt-2 flex items-start gap-2 text-xs text-muted">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">{STAGE_HELP[lead.stage]}</p>
      </div>
    </div>
  );
}
