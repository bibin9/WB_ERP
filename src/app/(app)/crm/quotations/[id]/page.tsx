import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileSignature } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import PrintReport from "@/components/finance/PrintReport";
import QuoteTracker from "@/components/crm/QuoteTracker";
import QuoteActions from "@/components/crm/QuoteActions";
import CostBar from "@/components/crm/CostBar";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { syncQuoteApproval } from "@/lib/quote-posting";
import { priceEstimate } from "@/lib/estimate-posting";
import { QUOTE_STATUS_HELP, poVariance } from "@/lib/quoting";
import { markupToMargin } from "@/lib/estimating";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * One quotation (CRM-13 to CRM-17).
 *
 * The approval is read on the way in rather than waiting for something to fire
 * at the right moment, the same as a purchase order: the approval is the
 * source of truth and the document follows it, so a signature in the inbox
 * cannot fail to reach this page.
 */
export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("crm.quotations");
  const session = await getSession();
  const { id } = await params;

  // Mirror whatever the approval says before anything is drawn.
  await syncQuoteApproval(id);

  const quote = await db.quotation.findUnique({
    where: { id },
    include: {
      lead: { select: { id: true, number: true, title: true, contactEmail: true, contactName: true } },
      estimate: { include: { lines: { include: { takeoffs: true } } } },
      job: { select: { id: true, code: true, name: true } },
      supersedes: { select: { id: true, number: true, revision: true } },
      supersededBy: { select: { id: true, number: true, revision: true } },
    },
  });
  if (!quote) notFound();

  const accessible = session?.companies ?? [];
  if (!accessible.some((c) => c.id === quote.companyId)) notFound();
  const company = await db.company.findUnique({ where: { id: quote.companyId } });

  const totals = quote.estimate ? priceEstimate(quote.estimate) : null;
  const margin = quote.total > 0 ? (quote.total - quote.costAtQuote) / quote.total : 0;
  const markup = quote.costAtQuote > 0 ? (quote.total - quote.costAtQuote) / quote.costAtQuote : 0;
  const variance = quote.poValue != null ? poVariance(quote.total, quote.poValue) : null;

  return (
    <div>
      <PrintHeader companyName={company?.name ?? ""} logoUrl={company?.logoUrl} title={`Quotation — ${quote.number}`} />

      <div className="mb-3 print:hidden">
        <Link href="/crm/quotations" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All quotations
        </Link>
      </div>

      <PageHeader
        title={quote.title}
        subtitle={`${quote.number}${quote.revision > 1 ? ` · revision ${quote.revision}` : ""} · ${quote.customerName}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          <QuoteActions
            quote={{
              id: quote.id, number: quote.number, status: quote.status,
              total: quote.total, customerName: quote.customerName,
              contactEmail: quote.lead?.contactEmail ?? null,
            }}
          />
        </div>
      </PageHeader>

      <div className="card mb-5 px-6 py-5">
        <QuoteTracker status={quote.status} />
      </div>

      {quote.status === "Accepted" && variance && (
        <div className="mb-5 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Won.</span> Their order{" "}
          <span className="font-mono">{quote.poNumber}</span> of {fmt(quote.poDate)} for{" "}
          {money(variance.ordered)}
          {!variance.matches && (
            <>
              {" "}— {money(Math.abs(variance.difference))} {variance.direction === "more" ? "more" : "less"} than
              quoted, acknowledged at the time
            </>
          )}
          .{" "}
          {quote.job && (
            <>
              It became job <Link href="/finance/jobs" className="font-mono underline">{quote.job.code}</Link>,
              carrying their figure as its contract value.
            </>
          )}
        </div>
      )}

      {quote.status === "Declined" && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Declined</span> on {fmt(quote.closedAt)}
          {quote.closedBy && <> — recorded by {quote.closedBy}</>}.
          <div className="mt-1 text-xs">{quote.declinedReason}</div>
        </div>
      )}

      {quote.supersededBy && (
        <div className="mb-5 rounded-lg border border-line bg-brand-paper px-4 py-3 text-sm text-ink">
          Replaced by{" "}
          <Link href={`/crm/quotations/${quote.supersededBy.id}`} className="font-mono underline">
            {quote.supersededBy.number}
          </Link>{" "}
          (revision {quote.supersededBy.revision}). This one is kept because the customer still has it.
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Quoted</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-heading">{money(quote.total)}</div>
          <div className="text-xs text-muted">
            {pct(margin)} margin · {pct(markup)} markup
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Costed at</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-heading">{money(quote.costAtQuote)}</div>
          <div className="text-xs text-muted">{quote.budgetHours.toLocaleString()} labour hours</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Held until</div>
          <div className="mt-1 text-lg font-semibold text-heading">{fmt(quote.validUntil)}</div>
          <div className="text-xs text-muted">prepared by {quote.preparedBy}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Status</div>
          <div className="mt-1 text-lg font-semibold text-heading">{quote.status}</div>
          <div className="text-xs text-muted">{QUOTE_STATUS_HELP[quote.status]}</div>
        </div>
      </div>

      {quote.issuedAt && (
        <p className="mb-5 text-xs text-muted">
          Issued {fmt(quote.issuedAt)} by {quote.issuedBy} to{" "}
          <span className="text-ink">{quote.issuedTo}</span>.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            What is behind the price
          </h2>
          {totals ? (
            <>
              <CostBar totals={totals} />
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                The price came from estimate{" "}
                <Link href={`/crm/estimates/${quote.estimateId}`} className="font-mono underline">
                  {quote.estimate?.number}
                </Link>{" "}
                and was snapshotted when this quotation was raised, so the estimate can carry on being edited for
                the next revision without changing what the customer was sent. The bar shows that estimate as it
                stands now; if it differs from the figures above, that is the difference between what was sent and
                what has been reworked since.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">The estimate behind this quotation is no longer available.</p>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Customer</h2>
            <div className="text-sm text-ink">{quote.customerName}</div>
            {quote.lead?.contactName && <div className="text-xs text-muted">{quote.lead.contactName}</div>}
            {quote.lead?.contactEmail && <div className="text-xs text-muted">{quote.lead.contactEmail}</div>}
            {quote.lead && (
              <Link href={`/crm/${quote.lead.id}`} className="mt-2 block text-xs text-brand-blue-600 underline">
                Enquiry {quote.lead.number}
              </Link>
            )}
          </div>

          {quote.supersedes && (
            <div className="card p-4">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Replaces</h2>
              <Link href={`/crm/quotations/${quote.supersedes.id}`} className="font-mono text-sm underline">
                {quote.supersedes.number}
              </Link>
              <div className="text-xs text-muted">revision {quote.supersedes.revision}</div>
            </div>
          )}

          {(quote.terms || quote.notes) && (
            <div className="card p-4">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Terms</h2>
              {quote.terms && <p className="whitespace-pre-wrap text-sm text-ink">{quote.terms}</p>}
              {quote.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{quote.notes}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          The price on this quotation came from the estimate and could not be typed over &mdash; that is the point
          of having built the estimate up. Nothing reaches a customer before management has signed it, because a
          quotation is a commitment and sending one unapproved is how a company finds out what it agreed to when
          the order arrives. Once it is out it is revised rather than edited: the customer is holding a piece of
          paper, and two people reading different documents is worse than no system at all. And when their order
          comes in, the job is created at <span className="font-medium">their</span> figure rather than ours,
          because customers round, trim scope and agree discounts on the phone &mdash; taking the quoted number
          because it is the one already in the system makes every margin report on that contract wrong from the
          first day.
        </p>
      </div>
    </div>
  );
}
