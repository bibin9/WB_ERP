import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scale, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import PrintReport from "@/components/finance/PrintReport";
import AskVendors from "@/components/inventory/AskVendors";
import QuotationForm from "@/components/inventory/QuotationForm";
import AwardForm from "@/components/inventory/AwardForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { MIN_VENDORS, RFQ_STATUS_HELP, rankQuotes, summariseRfq, rfqVerdict } from "@/lib/rfq";
import { ratingsFor } from "@/lib/vendorrating-data";
import { vendorVerdict } from "@/lib/vendorrating";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The comparison sheet (INV-09).
 *
 * One column per supplier, one row per line, so the thing a buyer is actually
 * doing — reading across — is what the page is shaped like. A list of
 * quotations one under another makes the reader hold three numbers in their
 * head to compare one line, which is how the wrong one gets picked.
 *
 * Suppliers who were asked and said nothing keep their column, greyed. Dropping
 * them would make a comparison of two quotes look like a comparison of two
 * suppliers, when a third was asked and stayed silent — and that silence is
 * worth seeing.
 */
export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("inventory.rfq");
  const session = await getSession();
  const { id } = await params;

  const rfq = await db.rfq.findUnique({
    where: { id },
    include: {
      job: { select: { code: true, name: true } },
      request: { select: { id: true, number: true } },
      awardedParty: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      quotes: { include: { lines: true }, orderBy: { invitedAt: "asc" } },
    },
  });
  if (!rfq) notFound();

  // The company must be one this user can actually see.
  const accessible = session?.companies ?? [];
  if (!accessible.some((c) => c.id === rfq.companyId)) notFound();
  const company = await db.company.findUnique({ where: { id: rfq.companyId } });

  const quantityOf = new Map(rfq.lines.map((l) => [l.id, l.quantity]));
  const quotes = rfq.quotes.map((q) => ({
    partyId: q.partyId,
    partyName: q.partyName,
    lines: q.lines.map((l) => ({ quantity: quantityOf.get(l.rfqLineId) ?? 0, unitPrice: l.unitPrice })),
    delivery: q.delivery,
    leadTimeDays: q.leadTimeDays,
    validUntil: iso(q.validUntil),
    received: !!q.receivedAt,
  }));

  const neededBy = iso(rfq.neededBy);
  const ranked = rankQuotes(quotes, { neededBy });
  const totals = summariseRfq(quotes);
  const verdict = rfqVerdict(quotes, neededBy);

  /** Price per line per supplier, for reading across a row. */
  const priceAt = new Map<string, number>();
  for (const q of rfq.quotes) for (const l of q.lines) priceAt.set(`${q.partyId}:${l.rfqLineId}`, l.unitPrice);

  const open = rfq.status !== "Awarded" && rfq.status !== "Cancelled";

  const notAsked = await db.party.findMany({
    where: {
      companyId: rfq.companyId,
      isActive: true,
      type: { not: "Customer" },
      id: { notIn: rfq.quotes.map((q) => q.partyId) },
    },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
  /**
   * How each bidder has actually performed (INV-06's past-performance leg).
   *
   * Read fresh rather than stored, and shown beside the price rather than
   * folded into it — see the note at the foot of this page on why there is no
   * combined score.
   */
  const ratings = await ratingsFor(rfq.companyId, rfq.quotes.map((q) => q.partyId));

  const stores = await db.store.findMany({
    where: { companyId: rfq.companyId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, isDefault: true },
  });

  return (
    <div>
      <PrintHeader companyName={company?.name ?? ""} logoUrl={company?.logoUrl} title={`Comparison — ${rfq.number}`} />

      <div className="mb-3 print:hidden">
        <Link href="/inventory/rfq" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All enquiries
        </Link>
      </div>

      <PageHeader title={rfq.number} subtitle={verdict}>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {open && <AskVendors rfqId={rfq.id} candidates={notAsked} />}
          {open && totals.quoted > 0 && (
            <AwardForm
              rfqId={rfq.id}
              ranked={ranked}
              stores={stores}
              enoughInvited={totals.enoughInvited}
              minVendors={MIN_VENDORS}
            />
          )}
        </div>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Raised</div>
          <div className="mt-1 text-sm text-ink">{fmt(rfq.date)}</div>
          <div className="text-xs text-muted">by {rfq.raisedBy}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Needed by</div>
          <div className="mt-1 text-sm text-ink">{fmt(rfq.neededBy)}</div>
          <div className="text-xs text-muted">
            {rfq.job ? `${rfq.job.code} — ${rfq.job.name}` : "Not for a particular job"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Suppliers</div>
          <div className={`mt-1 text-sm ${totals.enoughInvited ? "text-ink" : "text-brand-gold"}`}>
            {totals.invited} asked, {totals.quoted} replied
          </div>
          <div className="text-xs text-muted">
            {totals.enoughInvited ? "Enough to award" : `${MIN_VENDORS} needed before awarding`}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Status</div>
          <div className="mt-1 text-sm text-ink">{rfq.status}</div>
          <div className="text-xs text-muted">{RFQ_STATUS_HELP[rfq.status]}</div>
        </div>
      </div>

      {rfq.status === "Awarded" && (
        <div className="mb-5 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Awarded to {rfq.awardedParty?.name}</span>
          {rfq.awardedBy && <> by {rfq.awardedBy}</>} on {fmt(rfq.awardedAt)}.{" "}
          {rfq.orderId && (
            <Link href="/inventory/orders" className="underline">
              See the purchase order it raised
            </Link>
          )}
          {rfq.awardReason && (
            <div className="mt-1.5 text-xs">
              <span className="font-medium">Not the lowest quote. Reason given:</span> {rfq.awardReason}
            </div>
          )}
        </div>
      )}

      {rfq.request && (
        <div className="mb-5 text-xs text-muted">
          Raised from material request{" "}
          <Link href="/inventory/requests" className="underline">{rfq.request.number}</Link>.
        </div>
      )}

      {/* ============================================ the comparison sheet == */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">What was asked for</th>
              <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
              {ranked.map((q) => (
                <th key={q.partyId} className="px-4 py-2.5 text-right font-medium">
                  <div className={q.received ? "text-heading" : "text-muted/60"}>{q.partyName}</div>
                  <div className="font-normal normal-case tracking-normal">
                    {q.received ? (
                      <span className={q.isLowest ? "text-brand-green-700" : "text-muted"}>
                        {q.isLowest ? "lowest" : `+${money(q.extraOverLowest)}`}
                      </span>
                    ) : (
                      <span className="text-muted/60">no reply</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rfq.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5">
                  <span className="text-ink">{l.description}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">
                  {l.quantity.toLocaleString()} {l.unitCode}
                </td>
                {ranked.map((q) => {
                  const price = priceAt.get(`${q.partyId}:${l.id}`);
                  // The cheapest on this line, which is not always the cheapest
                  // overall — worth seeing when a split order is an option.
                  const best = Math.min(
                    ...ranked
                      .filter((r) => r.received)
                      .map((r) => priceAt.get(`${r.partyId}:${l.id}`) ?? Infinity),
                  );
                  return (
                    <td
                      key={q.partyId}
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        price == null
                          ? "text-muted/40"
                          : price === best
                            ? "font-medium text-brand-green-700"
                            : "text-ink"
                      }`}
                    >
                      {price == null ? "—" : money(price)}
                    </td>
                  );
                })}
              </tr>
            ))}

            <tr className="bg-brand-paper/60">
              <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted">Delivery and carriage</td>
              <td />
              {ranked.map((q) => {
                const row = rfq.quotes.find((x) => x.partyId === q.partyId);
                return (
                  <td key={q.partyId} className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {q.received ? (row?.delivery ? money(row.delivery) : "included") : "—"}
                  </td>
                );
              })}
            </tr>

            <tr className="border-t-2 border-line font-medium">
              <td className="px-4 py-3 text-heading">Total</td>
              <td />
              {ranked.map((q) => (
                <td
                  key={q.partyId}
                  className={`px-4 py-3 text-right tabular-nums ${
                    !q.received ? "text-muted/40" : q.isLowest ? "text-brand-green-700" : "text-ink"
                  }`}
                >
                  {q.received ? money(q.total) : "—"}
                </td>
              ))}
            </tr>

            <tr>
              <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted">Lead time</td>
              <td />
              {ranked.map((q) => (
                <td key={q.partyId} className="px-4 py-2.5 text-right text-xs">
                  {q.leadTimeDays == null ? (
                    <span className="text-muted/60">not stated</span>
                  ) : (
                    <span className={q.late ? "text-brand-gold" : "text-muted"}>
                      {q.leadTimeDays} days
                      {q.late && (
                        <span className="block" title="Arrives after the date site needs it">
                          after site needs it
                        </span>
                      )}
                    </span>
                  )}
                </td>
              ))}
            </tr>

            <tr className="align-top">
              <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted">Past performance</td>
              <td />
              {ranked.map((q) => {
                const r = ratings[q.partyId];
                return (
                  <td
                    key={q.partyId}
                    className="px-4 py-2.5 text-right text-xs"
                    title={r ? vendorVerdict(r) : undefined}
                  >
                    {!r || !r.anyHistory ? (
                      <span className="text-muted/60">no history yet</span>
                    ) : (
                      <div className="space-y-0.5">
                        {r.delivery.enough && (
                          <div className={r.delivery.otifRate < 0.8 ? "text-brand-gold" : "text-muted"}>
                            {Math.round(r.delivery.otifRate * 100)}% on time in full
                            <span className="text-muted/60"> ({r.delivery.considered})</span>
                          </div>
                        )}
                        {r.quality.enough && (
                          <div className={r.quality.defectRate > 0 ? "text-brand-gold" : "text-muted"}>
                            {Math.round(r.quality.defectRate * 100)}% rejected
                            <span className="text-muted/60"> ({r.quality.inspected})</span>
                          </div>
                        )}
                        {r.response.enough && (
                          <div className="text-muted">
                            replied {r.response.replied}/{r.response.asked}
                            {r.response.medianDays != null && <> in {r.response.medianDays}d</>}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted">Price held until</td>
              <td />
              {ranked.map((q) => {
                const row = rfq.quotes.find((x) => x.partyId === q.partyId);
                return (
                  <td key={q.partyId} className="px-4 py-2.5 text-right text-xs">
                    {!q.received || !row?.validUntil ? (
                      <span className="text-muted/60">—</span>
                    ) : (
                      <span className={q.expired ? "text-brand-gold" : "text-muted"}>
                        {fmt(row.validUntil)}
                        {q.expired && <span className="block">expired</span>}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {open && (
              <tr className="print:hidden">
                <td className="px-4 py-2.5" />
                <td />
                {ranked.map((q) => (
                  <td key={q.partyId} className="px-4 py-2.5 text-right">
                    <QuotationForm
                      rfqId={rfq.id}
                      partyId={q.partyId}
                      partyName={q.partyName}
                      lines={rfq.lines.map((l) => ({
                        id: l.id,
                        description: l.description,
                        unitCode: l.unitCode,
                        quantity: l.quantity,
                        price: priceAt.get(`${q.partyId}:${l.id}`) ?? null,
                      }))}
                      delivery={rfq.quotes.find((x) => x.partyId === q.partyId)?.delivery ?? 0}
                      leadTimeDays={q.leadTimeDays}
                      validUntil={iso(rfq.quotes.find((x) => x.partyId === q.partyId)?.validUntil ?? null)}
                      received={q.received}
                    />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rfq.quotes.length === 0 && (
        <div className="mt-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />
          Nobody has been asked yet. Use <span className="font-medium">Ask suppliers</span> to invite at least{" "}
          {MIN_VENDORS}.
        </div>
      )}

      {rfq.notes && <p className="mt-5 text-sm text-muted">{rfq.notes}</p>}

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Scale className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Read across a row to compare one line, down a column to compare a supplier. The cheapest figure on each
          line is marked, which is not always the same supplier as the cheapest total — worth knowing when splitting
          the order between two of them is an option. There is deliberately no combined score: weighting price
          against lead time would need weights nobody agreed, and a number that looks objective while being
          invented is worse than none, because people stop arguing with it. Price is ranked, everything else is
          stated, and the buyer decides — and says why, if it is not the lowest.
        </p>
      </div>
    </div>
  );
}
