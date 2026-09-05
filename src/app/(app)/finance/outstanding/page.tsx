import Link from "next/link";
import { Clock, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { ageParty, type PartyDoc, type Ageing } from "@/lib/ageing";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

type Row = { id: string; code: string; name: string; creditDays: number; ageing: Ageing };

export default async function OutstandingPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; side?: string; p?: string }>;
}) {
  await requireAccess("finance.outstanding");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const side = sp.side === "payable" ? "payable" : "receivable";
  const asAt = new Date();

  // Which accounts represent money owed to us, and money we owe.
  const control = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId, controlType: side === "receivable" ? "Receivable" : "Payable" },
        select: { id: true, code: true, name: true },
      })
    : [];
  const controlIds = new Set(control.map((c) => c.id));

  const parties = companyId
    ? await db.party.findMany({
        where: { companyId, type: side === "receivable" ? { in: ["Customer", "Both"] } : { in: ["Supplier", "Both"] } },
        orderBy: { name: "asc" },
      })
    : [];

  const entries =
    companyId && controlIds.size > 0
      ? await db.journalEntry.findMany({
          where: { companyId, partyId: { not: null } },
          include: { lines: { select: { debit: true, credit: true, accountId: true } } },
          orderBy: { date: "asc" },
        })
      : [];

  // Group each voucher's effect on the control accounts, by party.
  const byParty = new Map<string, PartyDoc[]>();
  for (const e of entries) {
    const net = e.lines
      .filter((l) => controlIds.has(l.accountId))
      .reduce((s, l) => s + l.debit - l.credit, 0);
    if (Math.abs(net) < 0.001) continue;
    const list = byParty.get(e.partyId!) ?? [];
    // For a supplier the signs are the other way round: what we owe is a credit.
    list.push({ reference: e.reference, date: e.date, amount: side === "receivable" ? net : -net });
    byParty.set(e.partyId!, list);
  }

  const rows: Row[] = parties
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      creditDays: p.creditDays,
      ageing: ageParty(byParty.get(p.id) ?? [], asAt, p.creditDays),
    }))
    .filter((r) => Math.abs(r.ageing.total) > 0.001 || r.ageing.unapplied > 0.001);

  const sum = (pick: (a: Ageing) => number) => rows.reduce((s, r) => s + pick(r.ageing), 0);
  const selected = sp.p ? rows.find((r) => r.id === sp.p) : undefined;

  const q = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ ...(companyId ? { c: companyId } : {}), side, ...extra });
    return `/finance/outstanding?${params.toString()}`;
  };

  const label = side === "receivable" ? "Receivable — owed to us" : "Payable — owed by us";

  return (
    <div>
      <PageHeader
        title="Finance — Outstanding & Ageing"
        subtitle="What is owed, how old it is, and which invoices are past their credit terms. Receipts settle the oldest invoice first."
      />
      <FinanceTabs companyId={companyId} />

      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={q({ side: "receivable" })} className={`rounded-lg border px-3 py-1.5 text-sm ${side === "receivable" ? "border-brand-blue bg-brand-blue/10 font-medium text-brand-blue-600" : "border-line text-muted hover:text-ink"}`}>
          Customers (receivable)
        </Link>
        <Link href={q({ side: "payable" })} className={`rounded-lg border px-3 py-1.5 text-sm ${side === "payable" ? "border-brand-blue bg-brand-blue/10 font-medium text-brand-blue-600" : "border-line text-muted hover:text-ink"}`}>
          Suppliers (payable)
        </Link>
        <span className="ml-auto text-xs text-muted">As at {fmt(asAt)}</span>
      </div>

      {control.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-muted">
          <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-brand-gold" />
          No {side} control account is set up yet. Open Finance → Overview, edit the account that holds
          {side === "receivable" ? " money owed to you (usually Accounts Receivable)" : " money you owe (usually Accounts Payable)"},
          and mark it as a control account.
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "Total outstanding", value: sum((a) => a.total), accent: "text-heading" },
              { label: "0 – 30 days", value: sum((a) => a.d30), accent: "text-ink" },
              { label: "31 – 60 days", value: sum((a) => a.d60), accent: "text-ink" },
              { label: "61 – 90 days", value: sum((a) => a.d90), accent: "text-brand-gold" },
              { label: "Over 90 days", value: sum((a) => a.d90plus), accent: "text-red-600" },
            ].map((c) => (
              <div key={c.label} className="stat-card">
                <div className="text-xs uppercase tracking-wide text-muted">{c.label}</div>
                <div className={`mt-1 text-xl font-bold tabular-nums ${c.accent}`}>{n(c.value)}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <Clock className="h-5 w-5 text-heading" />
              <h2 className="font-semibold text-heading">{label}</h2>
              <span className="ml-auto text-xs text-muted">{rows.length} with a balance</span>
            </div>

            {rows.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted">Nothing outstanding — everything is settled.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                      <th className="px-4 py-2 font-semibold">Party</th>
                      <th className="px-4 py-2 text-right font-semibold">0–30</th>
                      <th className="px-4 py-2 text-right font-semibold">31–60</th>
                      <th className="px-4 py-2 text-right font-semibold">61–90</th>
                      <th className="px-4 py-2 text-right font-semibold">90+</th>
                      <th className="px-4 py-2 text-right font-semibold">Overdue</th>
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.id} className={sp.p === r.id ? "bg-brand-blue/5" : ""}>
                        <td className="px-4 py-2.5">
                          <Link href={q({ p: r.id })} className="font-medium text-ink hover:text-brand-blue-600">{r.name}</Link>
                          <span className="ml-2 font-mono text-xs text-muted">{r.code}</span>
                          {r.ageing.unapplied > 0.001 && (
                            <span className="ml-2 text-xs text-brand-green-700">
                              {n(r.ageing.unapplied)} on account
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.ageing.d30 ? n(r.ageing.d30) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.ageing.d60 ? n(r.ageing.d60) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-brand-gold">{r.ageing.d90 ? n(r.ageing.d90) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{r.ageing.d90plus ? n(r.ageing.d90plus) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-brand-gold">{r.ageing.overdue ? n(r.ageing.overdue) : "—"}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{n(r.ageing.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-brand-paper font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{n(sum((a) => a.d30))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{n(sum((a) => a.d60))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{n(sum((a) => a.d90))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{n(sum((a) => a.d90plus))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{n(sum((a) => a.overdue))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{n(sum((a) => a.total))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Open items for one party — the list you work from when chasing payment. */}
          {selected && (
            <div className="card mt-5">
              <div className="border-b border-line px-5 py-3">
                <h2 className="font-semibold text-heading">{selected.name} — open items</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {selected.creditDays ? `${selected.creditDays}-day terms` : "Payment due on invoice"} ·
                  {" "}oldest first, settled by receipts as they came in
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                      <th className="px-4 py-2 font-semibold">Voucher</th>
                      <th className="px-4 py-2 font-semibold">Date</th>
                      <th className="px-4 py-2 font-semibold">Due</th>
                      <th className="px-4 py-2 text-right font-semibold">Invoice</th>
                      <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                      <th className="px-4 py-2 text-right font-semibold">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selected.ageing.items.map((i) => (
                      <tr key={i.reference}>
                        <td className="px-4 py-2 font-mono text-xs text-heading">{i.reference}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted">{fmt(i.date)}</td>
                        <td className={`px-4 py-2 whitespace-nowrap ${i.overdueDays > 0 ? "font-medium text-red-600" : "text-muted"}`}>
                          {fmt(i.dueDate)}
                          {i.overdueDays > 0 && <span className="ml-1 text-xs">({i.overdueDays}d late)</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{n(i.original)}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">{n(i.outstanding)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{i.daysOld}d</td>
                      </tr>
                    ))}
                    {selected.ageing.unapplied > 0.001 && (
                      <tr>
                        <td className="px-4 py-2 text-muted" colSpan={4}>Payments on account (not applied to an invoice)</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-brand-green-700">−{n(selected.ageing.unapplied)}</td>
                        <td className="px-4 py-2" />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
