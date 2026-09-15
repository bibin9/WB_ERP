import Link from "next/link";
import { Scale } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import RfqForm from "@/components/inventory/RfqForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { MIN_VENDORS, RFQ_STATUS_HELP, rankQuotes, summariseRfq } from "@/lib/rfq";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  Draft: "bg-line text-muted",
  Sent: "bg-brand-blue/10 text-brand-blue-600",
  Quoted: "bg-brand-gold/10 text-brand-gold",
  Awarded: "bg-brand-green/10 text-brand-green-700",
  Cancelled: "bg-line text-muted",
};

/**
 * Enquiries and quotations (INV-05 RFQ, INV-06, INV-09).
 *
 * The list leads with how many suppliers have been asked, because that is the
 * thing that blocks an award and the thing a buyer forgets. An enquiry with two
 * suppliers on it looks finished until somebody tries to award it.
 */
export default async function RfqPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("inventory.rfq");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const where = { companyId, ...(matchAny(term, ["number", "notes", "raisedBy"]) ?? {}) };
  const paging = readPaging(sp);
  const total = companyId ? await db.rfq.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const rows = companyId
    ? await db.rfq.findMany({
        where,
        include: {
          job: { select: { code: true, name: true } },
          awardedParty: { select: { name: true } },
          lines: true,
          quotes: { include: { lines: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const items = companyId
    ? await db.item.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, unitCode: true },
      })
    : [];
  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  /** Approved requests with nothing ordered against them yet. */
  const requests = companyId
    ? await db.materialRequest.findMany({
        where: { companyId, status: "Approved" },
        orderBy: { number: "desc" },
        select: { id: true, number: true },
        take: 50,
      })
    : [];

  const suppliers = companyId ? await db.party.count({ where: { companyId, isActive: true, type: { not: "Customer" } } }) : 0;

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Enquiries and Quotations" />

      <PageHeader
        title="Enquiries &amp; Quotes"
        subtitle="What several suppliers would charge, side by side, and why one of them was chosen."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && <RfqForm companyId={companyId} items={items} jobs={jobs} requests={requests} />}
        </div>
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      {companyId && suppliers < MIN_VENDORS && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            Only {suppliers} supplier{suppliers === 1 ? "" : "s"} on this company.
          </span>{" "}
          An enquiry needs {MIN_VENDORS} before it can be awarded. Add them on{" "}
          <Link href="/finance/parties" className="underline">Parties</Link>.
        </div>
      )}

      <div className="mb-4">
        <SearchBox placeholder="Search enquiry number, notes or who raised it" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Enquiry</th>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-4 py-2.5 text-right font-medium">Lines</th>
              <th className="px-4 py-2.5 font-medium">Suppliers asked</th>
              <th className="px-4 py-2.5 text-right font-medium">Lowest quote</th>
              <th className="px-4 py-2.5 font-medium">Awarded to</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term
                    ? "No enquiry has been raised yet. Raise one to ask several suppliers for a price."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const quantityOf = new Map(r.lines.map((l) => [l.id, l.quantity]));
              const quotes = r.quotes.map((q) => ({
                partyId: q.partyId,
                partyName: q.partyName,
                lines: q.lines.map((l) => ({ quantity: quantityOf.get(l.rfqLineId) ?? 0, unitPrice: l.unitPrice })),
                delivery: q.delivery,
                received: !!q.receivedAt,
              }));
              const t = summariseRfq(quotes);
              const lowest = rankQuotes(quotes).find((q) => q.isLowest);
              const short = t.invited < MIN_VENDORS && r.status !== "Awarded" && r.status !== "Cancelled";
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/inventory/rfq/${r.id}`} className="font-mono text-xs text-brand-blue-600 hover:underline">
                      {r.number}
                    </Link>
                    <div className="text-xs text-muted">{r.raisedBy}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmt(r.date)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.job ? (
                      <>
                        <span className="font-mono text-heading">{r.job.code}</span>
                        <div className="text-muted">{r.job.name}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{r.lines.length}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span className={short ? "font-medium text-brand-gold" : "text-ink"}>
                      {t.invited} asked
                    </span>
                    <div className="text-muted">
                      {t.quoted} replied
                      {short && `, ${MIN_VENDORS - t.invited} more needed`}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {t.quoted ? money(t.lowest) : <span className="text-muted">—</span>}
                    {t.spread > 0 && (
                      <div className="text-xs text-muted">spread {money(t.spread)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.awardedParty ? (
                      <>
                        <span className="text-ink">{r.awardedParty.name}</span>
                        {r.awardReason && (
                          <div className="text-muted" title={r.awardReason}>
                            not the lowest — reason recorded
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span
                      title={RFQ_STATUS_HELP[r.status]}
                      className={`rounded px-1.5 py-0.5 ${statusColour[r.status] ?? "bg-line text-muted"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="enquiries" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Scale className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Without an enquiry, a buyer rings the supplier they always ring. That is usually not even wrong, but there
          is no record that anybody else was asked, so a year later nobody can tell a good relationship from a bad
          habit — and on a cost-reimbursable contract the client&rsquo;s auditor asks to see the three quotes. So at
          least {MIN_VENDORS} suppliers are asked before anything can be awarded. The cheapest is not forced on
          anybody: the cheapest quote can arrive three weeks late from a supplier who shorted the last two orders.
          What is required is a reason, recorded at the moment of the decision, because that is the only time
          anybody still remembers it. The purchase order is then built from the winning quotation, so the price on
          the order is the price the supplier actually quoted.
        </p>
      </div>
    </div>
  );
}
