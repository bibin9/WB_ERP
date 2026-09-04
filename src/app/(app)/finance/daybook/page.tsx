import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const vColor: Record<string, string> = {
  Journal: "bg-brand-navy/5 text-heading", Payment: "bg-red-50 text-red-600", Receipt: "bg-brand-green/10 text-brand-green-700",
  Contra: "bg-brand-gold/15 text-brand-gold", Sales: "bg-brand-blue/10 text-brand-blue-600", Purchase: "bg-brand-navy/10 text-heading",
};

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("finance.daybook");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const entries = companyId
    ? await db.journalEntry.findMany({ where: { companyId }, include: { lines: { include: { account: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 })
    : [];

  return (
    <div>
      <PageHeader title="Finance — Day Book" subtitle="Every voucher in date order — Tally's Day Book. Filter by voucher type coming with reporting." />
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Voucher</th>
                <th className="px-4 py-2 font-semibold">Ref</th>
                <th className="px-4 py-2 font-semibold">Particulars</th>
                <th className="px-4 py-2 font-semibold">Party</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No vouchers yet.</td></tr>}
              {entries.map((e) => {
                const amount = e.lines.reduce((s, l) => s + l.debit, 0);
                const dr = e.lines.filter((l) => l.debit > 0).map((l) => l.account.name);
                const cr = e.lines.filter((l) => l.credit > 0).map((l) => l.account.name);
                return (
                  <tr key={e.id} className="align-top hover:bg-brand-paper/60">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmt(e.date)}</td>
                    <td className="px-4 py-2.5"><span className={clsx("rounded px-2 py-0.5 text-xs font-medium", vColor[e.voucherType] ?? vColor.Journal)}>{e.voucherType}</span></td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{e.reference}</td>
                    <td className="px-4 py-2.5 text-ink">
                      <div>Dr: {dr.join(", ")}</div>
                      <div className="text-muted">Cr: {cr.join(", ")}</div>
                      {e.memo && <div className="text-xs italic text-muted/80">{e.memo}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{e.partyName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">{n(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
