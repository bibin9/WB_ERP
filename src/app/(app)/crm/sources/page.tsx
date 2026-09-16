import Link from "next/link";
import { Compass } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import PrintReport from "@/components/finance/PrintReport";
import CrmTabs from "@/components/CrmTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import {
  MIN_DECIDED, summariseSources, summariseLosses, sourcesVerdict, lossesVerdict,
} from "@/lib/leads";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Where the work comes from, and why it is lost (CRM-01).
 *
 * Every enquiry has carried a source, a reason it was lost and the name of
 * whoever took it, and not one of the three was added up anywhere. That makes
 * the fields a cost with no benefit: people type into boxes that feed nothing,
 * and what they type gets worse every month until the data is not worth having.
 * These are the two questions those boxes exist to answer, and they are the two
 * a marketing manager is actually accountable for.
 *
 * Ranked by what each source has WON rather than by how many enquiries it
 * produced. Counting enquiries flatters whichever channel is cheapest to
 * generate — a tender portal will always win on volume — and volume is not
 * what pays wages.
 */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("crm.leads");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const leads = companyId
    ? await db.lead.findMany({
        where: { companyId },
        select: {
          stage: true, source: true, estimatedValue: true, lostReason: true, lostTo: true,
        },
      })
    : [];

  const sources = summariseSources(leads);
  const losses = summariseLosses(leads);
  const wonTotal = sources.reduce((s, r) => s + r.wonValue, 0);

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Where the Work Comes From" />

      <PageHeader title="Where the Work Comes From" subtitle={sourcesVerdict(sources)}>
        <PrintReport />
      </PageHeader>
      <CrmTabs />

      <div className="mb-5 print:hidden">
        <CompanyPicker companies={accessible} current={companyId} />
      </div>

      {leads.length === 0 ? (
        <p className="card p-6 text-sm text-muted">
          No enquiries have been logged yet. Once they have, this page says which sources bring work in and which
          only bring enquiries.
        </p>
      ) : (
        <>
          {/* ============================================== by source == */}
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">By source</h2>
          <div className="card mb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2 text-right">Enquiries</th>
                  <th className="px-4 py-2 text-right">Won</th>
                  <th className="px-4 py-2 text-right">Lost</th>
                  <th className="px-4 py-2 text-right">Still open</th>
                  <th className="px-4 py-2 text-right">Won value</th>
                  <th className="px-4 py-2 text-right">Share of won</th>
                  <th className="px-4 py-2 text-right">Weighted pipeline</th>
                  <th className="px-4 py-2 text-right">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((r) => (
                  <tr key={r.source} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium text-ink">{r.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-brand-green-700">{r.won}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.lost}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.open}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-heading">
                      {r.wonValue > 0 ? money(r.wonValue) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">
                      {wonTotal > 0 && r.wonValue > 0 ? pct(r.wonValue / wonTotal) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.weighted > 0 ? money(r.weighted) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.winRate == null ? (
                        <span
                          className="text-xs text-muted"
                          title={`Fewer than ${MIN_DECIDED} decided, which is too few for a percentage to mean anything`}
                        >
                          too few
                        </span>
                      ) : (
                        pct(r.winRate)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-8 max-w-3xl text-xs text-muted">
            Ranked by what each source has <span className="font-medium text-ink">won</span>, not by how many
            enquiries it produced. A tender portal will always win on volume, and volume is not what pays wages. A
            win rate is withheld until {MIN_DECIDED} enquiries from that source have actually been decided: one win
            out of two is not a fifty per cent channel, and a percentage printed beside a number that small gets
            quoted in a meeting as though it were. &ldquo;Not recorded&rdquo; is shown rather than hidden, because a
            large number there means the rest of this table is worth less than it looks.
          </p>

          {/* =============================================== why lost == */}
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">Why work was lost</h2>
          <p className="mb-3 text-sm text-ink">{lossesVerdict(losses)}</p>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card overflow-x-auto">
              <div className="border-b border-line px-4 py-2 text-xs uppercase tracking-wide text-muted">
                Reasons
              </div>
              {losses.reasons.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nothing lost has a reason recorded against it.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {losses.reasons.map((r) => (
                      <tr key={r.reason} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-ink">{r.reason}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{r.count}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-heading">
                          {money(r.value)}
                        </td>
                      </tr>
                    ))}
                    {losses.unexplained > 0 && (
                      <tr className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-brand-gold">Nothing was said</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{losses.unexplained}</td>
                        <td className="px-4 py-2 text-right text-xs text-muted">the reason was not recorded</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card overflow-x-auto">
              <div className="border-b border-line px-4 py-2 text-xs uppercase tracking-wide text-muted">
                Who took the work
              </div>
              {losses.competitors.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  Nobody has been named as winning work we lost. It is worth asking: the same two or three names
                  usually account for most of it.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {losses.competitors.map((c) => (
                      <tr key={c.reason} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-ink">{c.reason}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{c.count}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-heading">
                          {money(c.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Compass className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Both halves of this page are built from boxes somebody fills in on an ordinary working day &mdash; the
          source when an enquiry is logged, the reason and the rival when it is lost. That is the whole argument for
          demanding a reason at the moment of the loss rather than letting the stage be changed silently: it is the
          only time anybody still remembers, and this is what it was remembered for. If the
          &ldquo;Not recorded&rdquo; row or the &ldquo;Nothing was said&rdquo; row is large, the honest reading is
          not that the channels are performing as shown &mdash; it is that the answer is not known yet.{" "}
          <Link href="/crm" className="underline">Back to the pipeline</Link>.
        </p>
      </div>
    </div>
  );
}
