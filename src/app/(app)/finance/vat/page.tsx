import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VAT_RATE = 0.05; // UAE standard rate
const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Output VAT = VAT charged on sales/receipts; Input VAT = VAT paid on purchases/payments.
const OUTPUT_TYPES = new Set(["Sales", "Receipt"]);
const INPUT_TYPES = new Set(["Purchase", "Payment"]);

export default async function VatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("finance.vat");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const entries = companyId
    ? await db.journalEntry.findMany({
        where: { companyId, vatAmount: { gt: 0 }, date: { gte: yearStart } },
        orderBy: { date: "asc" },
      })
    : [];

  const output = entries.filter((e) => OUTPUT_TYPES.has(e.voucherType));
  const input = entries.filter((e) => INPUT_TYPES.has(e.voucherType));
  const other = entries.filter((e) => !OUTPUT_TYPES.has(e.voucherType) && !INPUT_TYPES.has(e.voucherType));

  const sum = (rows: typeof entries) => rows.reduce((s, e) => s + e.vatAmount, 0);
  const outputVat = sum(output);
  const inputVat = sum(input);
  const netVat = outputVat - inputVat;

  return (
    <div>
      <PageHeader title="Finance — VAT Report" subtitle="UAE FTA VAT summary (standard rate 5%), current year — from posted vouchers." />
      <FinanceTabs companyId={companyId} />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <div className="text-sm text-muted">Output VAT (on sales)</div>
          <div className="mt-1 text-2xl font-bold text-heading tabular-nums">{n(outputVat)}</div>
          <div className="mt-0.5 text-xs text-muted">Taxable value ≈ {n(outputVat / VAT_RATE)}</div>
        </div>
        <div className="stat-card">
          <div className="text-sm text-muted">Input VAT (on purchases)</div>
          <div className="mt-1 text-2xl font-bold text-heading tabular-nums">{n(inputVat)}</div>
          <div className="mt-0.5 text-xs text-muted">Recoverable · taxable value ≈ {n(inputVat / VAT_RATE)}</div>
        </div>
        <div className="stat-card">
          <div className="text-sm text-muted">{netVat >= 0 ? "Net VAT payable to FTA" : "Net VAT refundable"}</div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${netVat >= 0 ? "text-red-600" : "text-brand-green-700"}`}>{n(Math.abs(netVat))}</div>
          <div className="mt-0.5 text-xs text-muted">Output − Input VAT</div>
        </div>
      </div>

      {/* Detail */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">VAT transactions</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Voucher</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Party</th>
                <th className="px-4 py-3 text-right font-semibold">Taxable value</th>
                <th className="px-4 py-3 text-right font-semibold">VAT</th>
                <th className="px-4 py-3 font-semibold">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No VAT recorded this year. Add the VAT amount when posting Sales / Purchase vouchers.</td></tr>
              )}
              {entries.map((e) => {
                const cat = OUTPUT_TYPES.has(e.voucherType) ? "Output" : INPUT_TYPES.has(e.voucherType) ? "Input" : "Unclassified";
                return (
                  <tr key={e.id} className="hover:bg-brand-paper/60">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDate(e.date)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-heading">{e.reference}</td>
                    <td className="px-4 py-3 text-ink">{e.voucherType}</td>
                    <td className="px-4 py-3 text-ink">{e.partyName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{n(e.vatAmount / VAT_RATE)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{n(e.vatAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        cat === "Output" ? "bg-brand-blue/10 text-brand-blue-600"
                        : cat === "Input" ? "bg-brand-green/10 text-brand-green-700"
                        : "bg-line text-muted"}`}>{cat}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-brand-paper font-semibold text-ink">
                  <td className="px-4 py-3" colSpan={5}>Net VAT {netVat >= 0 ? "payable" : "refundable"}</td>
                  <td className="px-4 py-3 text-right tabular-nums" colSpan={2}>{n(Math.abs(netVat))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {other.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Note: {other.length} VAT voucher(s) are of a type not auto-classified as output/input (e.g. Journal/Contra) — review their category before filing.
        </p>
      )}
      <div className="mt-4 rounded-lg bg-brand-blue/5 p-3 text-xs text-muted">
        <span className="font-medium text-ink">How this is built:</span> VAT is read from the <span className="text-ink">VAT amount</span> entered on each voucher.
        Sales &amp; Receipt vouchers count as <span className="text-ink">output VAT</span>; Purchase &amp; Payment as <span className="text-ink">input (recoverable) VAT</span>.
        Taxable value is estimated at the 5% standard rate. Full FTA return periods (quarterly) and zero-rated/exempt handling come with the tax-filing feature.
      </div>
    </div>
  );
}
