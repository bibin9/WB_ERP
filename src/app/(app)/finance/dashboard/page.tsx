import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { Tile, Tiles, Section, Sections, Figure, Figures, Line, List, MonthColumns, NothingToShow, aed, aedShort, plural, daysFrom, dueText } from "@/components/dashboards/Kit";
import { companyScope, ALL_COMPANIES } from "@/lib/company-scope";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });

/**
 * Finance at a glance: how the year is going, where the cash is, who owes
 * whom, and what falls due in the next month. Each panel shows only to those
 * who can open the screen it summarises (components/dashboards/Kit.tsx).
 */
export default async function FinanceDashboard({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireAccess("finance");
  const scoped = companyScope(session.companies, (await searchParams).c);
  const ids = scoped.ids;
  const one = scoped.current === ALL_COMPANIES ? "" : scoped.current;
  const q = one ? `?c=${one}` : "";

  const g = {
    reports: can(session, "finance.reports"),
    cash: can(session, "finance.cashflow") || can(session, "finance.ledgers") || can(session, "finance.reports"),
    outstanding: can(session, "finance.outstanding"),
    invoices: can(session, "finance.invoices"),
    cheques: can(session, "finance.cheques"),
    retention: can(session, "finance.retention"),
    vat: can(session, "finance.vat"),
    jobs: can(session, "finance.jobs"),
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const in30 = new Date(today.getTime() + 31 * 86400000);
  const in60 = new Date(today.getTime() + 61 * 86400000);
  const sixMonths = Array.from({ length: 6 }, (_, i) => {
    const from = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1), label: MONTH.format(from) };
  });

  // Every account the panels read, once. Income and expense for the year and
  // the months; Cash, Receivable and Payable by their control marking — the
  // same accounts the cash-flow forecast reads, so the two agree.
  const accounts = g.reports || g.cash || g.outstanding
    ? await db.chartOfAccount.findMany({
        where: { companyId: { in: ids } },
        select: { id: true, type: true, controlType: true, openingBalance: true },
      })
    : [];
  const pl = accounts.filter((a) => a.type === "Income" || a.type === "Expense");
  const typeOf = new Map(pl.map((a) => [a.id, a.type]));
  const control = accounts.filter((a) => a.controlType === "Cash" || a.controlType === "Receivable" || a.controlType === "Payable");

  const plBetween = (from: Date, to?: Date) =>
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: pl.map((a) => a.id) }, entry: { date: { gte: from, ...(to ? { lt: to } : {}) } } },
      _sum: { debit: true, credit: true },
    });
  const incomeAndCost = (rows: { accountId: string; _sum: { debit: number | null; credit: number | null } }[]) => {
    let income = 0, cost = 0;
    for (const r of rows) {
      const dr = r._sum.debit ?? 0, cr = r._sum.credit ?? 0;
      if (typeOf.get(r.accountId) === "Income") income += cr - dr;
      else cost += dr - cr;
    }
    return { income, cost };
  };

  const [ytdRows, monthRows, controlRows, cheques, drafts, issuedThisMonth, retention, vat, jobs] = await Promise.all([
    g.reports && pl.length ? plBetween(yearStart) : null,
    g.reports && pl.length ? Promise.all(sixMonths.map((m) => plBetween(m.from, m.to))) : null,
    control.length && (g.cash || g.outstanding)
      ? db.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: control.map((a) => a.id) } }, _sum: { debit: true, credit: true } })
      : null,
    g.cheques
      ? db.cheque.findMany({
          where: { companyId: { in: ids }, status: "In hand", chequeDate: { lt: in30 } },
          orderBy: { chequeDate: "asc" },
          select: { id: true, direction: true, chequeNo: true, partyName: true, amount: true, chequeDate: true },
        })
      : null,
    g.invoices ? db.invoice.count({ where: { companyId: { in: ids }, status: "Draft" } }) : null,
    g.invoices
      ? db.invoice.aggregate({ where: { companyId: { in: ids }, side: "Sales", docType: "Invoice", status: "Issued", issueDate: { gte: monthStart } }, _count: true, _sum: { grossTotal: true } })
      : null,
    g.retention
      ? db.retention.findMany({ where: { companyId: { in: ids }, status: "Held" }, select: { direction: true, amount: true, dueDate: true } })
      : null,
    g.vat
      ? db.journalEntry.groupBy({ by: ["voucherType"], where: { companyId: { in: ids }, vatAmount: { gt: 0 }, date: { gte: quarterStart } }, _sum: { vatAmount: true } })
      : null,
    g.jobs ? db.job.groupBy({ by: ["status"], where: { companyId: { in: ids }, status: { in: ["Open", "On hold"] } }, _count: true }) : null,
  ]);

  const ytd = ytdRows ? incomeAndCost(ytdRows) : null;
  const months = monthRows ? sixMonths.map((m, i) => ({ label: m.label, a: incomeAndCost(monthRows[i]).income, b: incomeAndCost(monthRows[i]).cost })) : null;

  // Control balances, debit positive; a payable is shown as what we owe.
  const balances = { Cash: 0, Receivable: 0, Payable: 0 } as Record<string, number>;
  const marked = new Set(control.map((a) => a.controlType as string));
  if (controlRows) {
    const net = new Map(controlRows.map((r) => [r.accountId, (r._sum.debit ?? 0) - (r._sum.credit ?? 0)]));
    for (const a of control) balances[a.controlType as string] += a.openingBalance + (net.get(a.id) ?? 0);
  }
  const owedToUs = balances.Receivable;
  const weOwe = -balances.Payable;

  const vatOut = vat?.filter((v) => ["Sales", "Receipt"].includes(v.voucherType)).reduce((s, v) => s + (v._sum.vatAmount ?? 0), 0) ?? 0;
  const vatIn = vat?.filter((v) => ["Purchase", "Payment"].includes(v.voucherType)).reduce((s, v) => s + (v._sum.vatAmount ?? 0), 0) ?? 0;

  const chequesIn = cheques?.filter((c) => c.direction === "Received") ?? [];
  const chequesOut = cheques?.filter((c) => c.direction === "Issued") ?? [];
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

  const retIn = retention?.filter((r) => r.direction === "Receivable") ?? [];
  const retOut = retention?.filter((r) => r.direction === "Payable") ?? [];
  const retDue = retIn.filter((r) => r.dueDate < in60);

  const anything = Object.values(g).some(Boolean);

  return (
    <div>
      <PageHeader title="Finance Dashboard" subtitle="How the year is going, where the cash is, and what falls due in the next month." />
      <div className="mb-5"><CompanyPicker companies={session.companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={scoped.current} allowAll label="Figures for:" /></div>
      <FinanceTabs companyId={one} />

      {!anything && <NothingToShow />}

      <Tiles>
        {ytd && <Tile label="Income this year" value={aedShort(ytd.income)} hint={`Sales and other income posted since 1 January ${now.getFullYear()}`} href={`/finance/reports${q}`} />}
        {ytd && <Tile label="Profit this year" value={aedShort(ytd.income - ytd.cost)} hint="Income less every cost posted this year" tone={ytd.income - ytd.cost >= 0 ? "good" : "bad"} href={`/finance/reports${q}`} />}
        {g.cash && (
          <Tile
            label="Cash in bank"
            value={marked.has("Cash") ? aedShort(balances.Cash) : "—"}
            hint={marked.has("Cash") ? "Balance of the accounts marked as Cash" : "No account is marked as Cash yet — Finance → Overview"}
            tone={marked.has("Cash") && balances.Cash < 0 ? "bad" : "neutral"}
            href={`/finance/cash-flow${q}`}
          />
        )}
        {g.outstanding && <Tile label="Customers owe us" value={aedShort(owedToUs)} hint="Unpaid on the receivables account" href={`/finance/outstanding${q}`} />}
      </Tiles>

      <Sections>
        {months && (
          <Section title="Income and costs, last six months" hint="Posted income against posted costs, month by month." href={`/finance/reports${q}`}>
            <MonthColumns months={months} a="Income" b="Costs" format={aedShort} />
          </Section>
        )}

        {g.outstanding && (
          <Section title="Who owes whom" hint="What customers owe us, and what we owe suppliers, today." href={`/finance/outstanding${q}`}>
            <Figures>
              <Figure label="Customers owe us" value={aed(owedToUs)} />
              <Figure label="We owe suppliers" value={aed(weOwe)} />
              <Figure label="Difference" value={aed(owedToUs - weOwe)} tone={owedToUs - weOwe >= 0 ? "good" : "warn"} />
            </Figures>
            {(!marked.has("Receivable") || !marked.has("Payable")) && (
              <p className="mt-3 text-xs text-muted">No account is marked as {!marked.has("Receivable") ? "Receivable" : "Payable"} yet, so it shows as zero.</p>
            )}
          </Section>
        )}

        {cheques && (
          <Section title="Cheques due in the next 30 days" hint="Post-dated cheques still in hand, by the date on the cheque." href={`/finance/cheques${q}`}>
            <Figures>
              <Figure label={`To deposit (${chequesIn.length})`} value={aed(sum(chequesIn))} tone="good" />
              <Figure label={`We have issued (${chequesOut.length})`} value={aed(sum(chequesOut))} tone={chequesOut.length ? "warn" : "neutral"} />
            </Figures>
            <div className="mt-3">
              <List
                empty="No cheques fall due in the next 30 days."
                rows={cheques.slice(0, 5).map((c) => {
                  const d = daysFrom(c.chequeDate, today);
                  return {
                    key: c.id,
                    href: `/finance/cheques${q}`,
                    label: `${c.direction === "Received" ? "From" : "To"} ${c.partyName ?? "—"} · #${c.chequeNo} · ${aed(c.amount)}`,
                    right: dueText(d),
                    tone: d < 0 ? "bad" : d <= 3 ? "warn" : "neutral",
                  };
                })}
              />
            </div>
          </Section>
        )}

        {g.invoices && (
          <Section title="Invoices" hint="Drafts wait for someone to issue them; nothing reaches the books until they do." href={`/finance/invoices${q}`}>
            <Figures>
              <Figure label="Drafts not issued" value={String(drafts ?? 0)} tone={drafts ? "warn" : "neutral"} />
              <Figure label="Sales invoices this month" value={String(issuedThisMonth?._count ?? 0)} />
              <Figure label="Invoiced this month" value={aed(issuedThisMonth?._sum.grossTotal ?? 0)} sub="including VAT" />
            </Figures>
          </Section>
        )}

        {retention && (
          <Section title="Retention" hint="Money held back on contracts until the work is signed off." href={`/finance/retention${q}`}>
            <Figures>
              <Figure label="Clients hold from us" value={aed(sum(retIn))} />
              <Figure label="We hold from subcontractors" value={aed(sum(retOut))} />
              <Figure label="Ours to claim within 60 days" value={aed(sum(retDue))} tone={retDue.length ? "good" : "neutral"} sub={plural(retDue.length, "retention")} />
            </Figures>
          </Section>
        )}

        {vat && (
          <Section title="VAT this quarter" hint="VAT charged on sales less VAT paid on purchases since the quarter began." href={`/finance/vat${q}`}>
            <Figures>
              <Figure label="On sales" value={aed(vatOut)} />
              <Figure label="On purchases" value={aed(vatIn)} />
              <Figure label={vatOut - vatIn >= 0 ? "Payable to the FTA" : "Refundable"} value={aed(Math.abs(vatOut - vatIn))} tone={vatOut - vatIn > 0 ? "warn" : "good"} />
            </Figures>
          </Section>
        )}

        {jobs && (
          <Section title="Jobs" hint="Contracts collecting costs and billing." href={`/finance/jobs${q}`}>
            <Line label="Open jobs" value={String(jobs.find((j) => j.status === "Open")?._count ?? 0)} href={`/finance/jobs${q}`} />
            <Line label="On hold" value={String(jobs.find((j) => j.status === "On hold")?._count ?? 0)} href={`/finance/jobs${q}`} tone="warn" />
          </Section>
        )}
      </Sections>
    </div>
  );
}
