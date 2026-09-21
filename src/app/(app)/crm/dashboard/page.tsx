import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import CrmTabs from "@/components/CrmTabs";
import { Tile, Tiles, Section, Sections, Figure, Figures, Line, List, Bars, NothingToShow, aed, aedShort, daysFrom, dueText } from "@/components/dashboards/Kit";
import { companyScope } from "@/lib/company-scope";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { LEAD_STAGES, summarisePipeline } from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * Sales at a glance: what the pipeline is worth, how much of it is likely to
 * be won, what has been won this year, and which quotations are waiting on a
 * customer or on an approval.
 */
export default async function CrmDashboard({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireAccess("crm");
  const scoped = companyScope(session.companies, (await searchParams).c);
  const inScope = { companyId: { in: scoped.ids } };

  const g = {
    leads: can(session, "crm.leads"),
    estimates: can(session, "crm.estimates"),
    quotations: can(session, "crm.quotations"),
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const in14 = new Date(today.getTime() + 15 * 86400000);

  const [leads, estimates, quotes, acceptedThisYear] = await Promise.all([
    // Open deals, and the ones decided this year — a win rate over all time
    // would still be counting the first month's guesses.
    g.leads
      ? db.lead.findMany({
          where: { ...inScope, OR: [{ stage: { notIn: ["Won", "Lost"] } }, { closedAt: { gte: yearStart } }] },
          select: { stage: true, estimatedValue: true },
        })
      : null,
    g.estimates ? db.estimate.groupBy({ by: ["status"], where: { ...inScope, status: { in: ["Draft", "Priced"] } }, _count: true }) : null,
    g.quotations
      ? db.quotation.findMany({
          where: { ...inScope, status: { in: ["Draft", "Awaiting approval", "Approved", "Issued"] } },
          orderBy: { validUntil: "asc" },
          select: { id: true, number: true, status: true, customerName: true, total: true, validUntil: true },
        })
      : null,
    g.quotations ? db.quotation.aggregate({ where: { ...inScope, status: "Accepted", closedAt: { gte: yearStart } }, _count: true, _sum: { total: true } }) : null,
  ]);

  const p = leads ? summarisePipeline(leads) : null;
  const issued = quotes?.filter((q) => q.status === "Issued") ?? [];
  const toApprove = quotes?.filter((q) => q.status === "Awaiting approval") ?? [];
  const toIssue = quotes?.filter((q) => q.status === "Draft" || q.status === "Approved") ?? [];
  const expiring = issued.filter((q) => q.validUntil && q.validUntil < in14);
  const est = (s: string) => estimates?.find((e) => e.status === s)?._count ?? 0;

  const anything = Object.values(g).some(Boolean);

  return (
    <div>
      <PageHeader title="Sales Dashboard" subtitle="What the pipeline is worth, what is likely to be won, and which quotations are waiting." />
      <div className="mb-5"><CompanyPicker companies={session.companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={scoped.current} allowAll label="Figures for:" /></div>
      <CrmTabs />

      {!anything && <NothingToShow />}

      <Tiles>
        {p && <Tile label="Open pipeline" value={aedShort(p.gross)} hint={`${p.open} open deals, at their estimated value`} href="/crm" />}
        {p && <Tile label="Likely to win" value={aedShort(p.weighted)} hint="Each deal weighted by how far along it is" href="/crm" />}
        {p && <Tile label="Won this year" value={aedShort(p.wonValue)} hint={p.decided ? `Won ${Math.round(p.winRate * 100)}% of the ${p.decided} deals decided this year` : "No deals decided yet this year"} tone={p.won ? "good" : "neutral"} href="/crm" />}
        {quotes && <Tile label="Quotes with customers" value={aedShort(issued.reduce((s, q) => s + q.total, 0))} hint={expiring.length ? `${expiring.length} expire within 14 days` : `${issued.length} issued, waiting for an answer`} tone={expiring.length ? "warn" : "neutral"} href="/crm/quotations" />}
      </Tiles>

      <Sections>
        {p && (
          <Section title="Pipeline by stage" hint="Open deals at their estimated value. The further along, the more likely." href="/crm">
            <Bars
              rows={LEAD_STAGES.filter((s) => s !== "Won" && s !== "Lost").map((s) => ({ label: s, value: p.byStage[s]?.gross ?? 0, note: `${p.byStage[s]?.count ?? 0}` }))}
              format={aedShort}
            />
          </Section>
        )}

        {quotes && (
          <Section title="Quotations expiring soon" hint="Issued quotations whose validity ends in the next 14 days — call the customer first." href="/crm/quotations">
            <List
              empty="No issued quotation expires in the next 14 days."
              rows={expiring.slice(0, 6).map((q) => {
                const d = daysFrom(q.validUntil as Date, today);
                return { key: q.id, href: "/crm/quotations", label: `${q.number} · ${q.customerName} · ${aed(q.total)}`, right: d < 0 ? `lapsed ${-d}d ago` : `valid ${dueText(d)}`, tone: d < 0 ? "bad" : "warn" };
              })}
            />
          </Section>
        )}

        {quotes && (
          <Section title="Quotations in progress" hint="From draft to the customer's answer." href="/crm/quotations">
            <Figures>
              <Figure label="Drafts and approved, not yet issued" value={String(toIssue.length)} />
              <Figure label="Awaiting approval" value={String(toApprove.length)} tone={toApprove.length ? "warn" : "neutral"} />
              <Figure label="Accepted this year" value={aed(acceptedThisYear?._sum.total ?? 0)} tone="good" sub={`${acceptedThisYear?._count ?? 0} orders`} />
            </Figures>
          </Section>
        )}

        {estimates && (
          <Section title="Estimates" hint="Pricing work not yet turned into a quotation." href="/crm/estimates">
            <Line label="Being built (draft)" value={String(est("Draft"))} href="/crm/estimates" />
            <Line label="Priced, ready to quote" value={String(est("Priced"))} href="/crm/estimates" tone={est("Priced") ? "warn" : "neutral"} />
          </Section>
        )}
      </Sections>
    </div>
  );
}
