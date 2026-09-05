import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceTabs from "@/components/FinanceTabs";
import PeriodPicker from "@/components/PeriodPicker";
import PrintReport from "@/components/finance/PrintReport";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolvePeriod, quarters } from "@/lib/period";
import { buildVat201, taxOn, OUTPUT_VOUCHERS, INPUT_VOUCHERS, ADJUSTMENT_VOUCHERS, type VatLine } from "@/lib/vat";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

/** One row of the return, numbered as the FTA numbers them. */
function Box({
  no,
  label,
  amount,
  vat,
  note,
  bold,
}: {
  no: string;
  label: string;
  amount: number;
  vat?: number;
  note?: string;
  bold?: boolean;
}) {
  return (
    <tr className={bold ? "border-t-2 border-line bg-brand-paper font-semibold" : ""}>
      <td className="w-12 px-4 py-2 text-xs text-muted">{no}</td>
      <td className="px-4 py-2 text-sm text-ink">
        {label}
        {note && <div className="text-xs font-normal text-muted">{note}</div>}
      </td>
      <td className="px-4 py-2 text-right text-sm tabular-nums text-ink">{n(amount)}</td>
      <td className="px-4 py-2 text-right text-sm tabular-nums text-ink">{vat === undefined ? "—" : n(vat)}</td>
    </tr>
  );
}

export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; from?: string; to?: string }>;
}) {
  await requireAccess("finance.vat");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";

  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  const period = resolvePeriod(sp, company?.fyStartMonth ?? 1);
  const qtrs = quarters(company?.fyStartMonth ?? 1);

  // Every line of every VAT-bearing voucher in the period. Treatment sits on
  // the line, because one invoice can mix standard, zero-rated and exempt work.
  const entries = companyId
    ? await db.journalEntry.findMany({
        where: {
          companyId,
          date: { gte: period.from, lte: period.to },
          voucherType: { in: [...OUTPUT_VOUCHERS, ...INPUT_VOUCHERS] },
        },
        include: { lines: true, party: { select: { name: true, trn: true } } },
        orderBy: { date: "asc" },
      })
    : [];

  const vatLines: VatLine[] = entries.flatMap((e) =>
    e.lines
      .filter((l) => l.vatTreatment)
      .map((l) => ({
        voucherType: e.voucherType,
        treatment: l.vatTreatment,
        // The line's own value is the taxable amount, whichever side it sits on.
        taxableValue: l.debit > 0 ? l.debit : l.credit,
      }))
  );

  const box = buildVat201(vatLines);

  // Vouchers that carry no treatment at all cannot be placed on the return.
  const untreated = entries.filter((e) => e.lines.every((l) => !l.vatTreatment));

  return (
    <div>
      <div className="print-header mb-4 border-b border-line pb-3">
        <div className="text-lg font-bold text-heading">{companyName}</div>
        <div className="text-sm text-ink">VAT Return (VAT 201)</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>

      <PageHeader
        title="Finance — VAT Return"
        subtitle="The figures for FTA form VAT 201, built from the treatment recorded on each voucher line."
      >
        <PrintReport />
      </PageHeader>
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>
      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} presets={qtrs} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="card overflow-x-auto">
            <div className="border-b border-line px-5 py-3">
              <h2 className="font-semibold text-heading">VAT 201</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                  <th className="px-4 py-2 font-semibold">Box</th>
                  <th className="px-4 py-2 font-semibold">Description</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount (AED)</th>
                  <th className="px-4 py-2 text-right font-semibold">VAT (AED)</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                <tr className="bg-brand-paper/60">
                  <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase text-muted">
                    VAT on sales and all other outputs
                  </td>
                </tr>
                <Box no="1" label="Standard rated supplies" amount={box.standardSupplies.amount} vat={box.standardSupplies.vat} />
                <Box no="3" label="Supplies subject to the reverse charge" amount={box.reverseChargeSupplies.amount} vat={box.reverseChargeSupplies.vat} />
                <Box no="4" label="Zero rated supplies" amount={box.zeroRatedSupplies} />
                <Box no="5" label="Exempt supplies" amount={box.exemptSupplies} />
                <Box
                  no="12"
                  label="Total output tax due"
                  amount={box.standardSupplies.amount + box.reverseChargeSupplies.amount + box.zeroRatedSupplies + box.exemptSupplies}
                  vat={box.outputTax}
                  bold
                />

                <tr className="bg-brand-paper/60">
                  <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase text-muted">
                    VAT on expenses and all other inputs
                  </td>
                </tr>
                <Box no="9" label="Standard rated expenses" amount={box.standardExpenses.amount} vat={box.standardExpenses.vat} />
                <Box no="10" label="Supplies subject to the reverse charge" amount={box.reverseChargeExpenses.amount} vat={box.reverseChargeExpenses.vat} />
                <Box
                  no="13"
                  label="Total input tax recoverable"
                  amount={box.standardExpenses.amount + box.reverseChargeExpenses.amount}
                  vat={box.inputTax}
                  bold
                />
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-line bg-brand-paper">
                  <td className="px-4 py-3 text-xs text-muted">14</td>
                  <td className="px-4 py-3 font-semibold text-heading">
                    {box.netPayable >= 0 ? "Net VAT payable to the FTA" : "Net VAT refundable by the FTA"}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right text-lg font-bold tabular-nums text-heading">{n(Math.abs(box.netPayable))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {box.unclassified > 0 && (
            <div className="card mt-4 border-brand-gold/40 p-4 text-sm">
              <span className="font-medium text-brand-gold">AED {n(box.unclassified)} is not on this return.</span>{" "}
              <span className="text-muted">
                Those voucher lines have no VAT treatment set, so they cannot be placed in a box. Open the vouchers
                below and set a treatment on each supply or expense line before you file.
              </span>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <div className="text-sm text-muted">{box.netPayable >= 0 ? "Payable to the FTA" : "Refundable"}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-heading">{n(Math.abs(box.netPayable))}</div>
            <div className="mt-3 space-y-1 text-xs text-muted">
              <div className="flex justify-between"><span>Output tax (box 12)</span><span className="tabular-nums">{n(box.outputTax)}</span></div>
              <div className="flex justify-between"><span>Input tax (box 13)</span><span className="tabular-nums">−{n(box.inputTax)}</span></div>
            </div>
          </div>

          <div className="card p-5 text-xs leading-relaxed text-muted">
            <div className="mb-2 text-sm font-semibold text-heading">How this is built</div>
            Each voucher line carries its own VAT treatment, so one invoice can mix standard-rated work with a
            zero-rated export. Credit and debit notes reduce what was already declared. Reverse charge appears in
            both box 3 and box 10 and nets to nil — that is how an imported service is self-accounted.
            <div className="mt-2 text-muted">Check the figures against your records before filing.</div>
          </div>
        </div>
      </div>

      {/* The detail behind the boxes */}
      <div className="card mt-5 overflow-x-auto">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Transactions in this period</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Date</th>
              <th className="px-4 py-2 font-semibold">Voucher</th>
              <th className="px-4 py-2 font-semibold">Type</th>
              <th className="px-4 py-2 font-semibold">Party</th>
              <th className="px-4 py-2 font-semibold">TRN</th>
              <th className="px-4 py-2 font-semibold">Treatment</th>
              <th className="px-4 py-2 text-right font-semibold">Taxable</th>
              <th className="px-4 py-2 text-right font-semibold">VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  No VAT vouchers in this period.
                </td>
              </tr>
            )}
            {entries.flatMap((e) =>
              e.lines
                .filter((l) => l.vatTreatment)
                .map((l) => {
                  const sign = ADJUSTMENT_VOUCHERS.has(e.voucherType) ? -1 : 1;
                  const taxable = (l.debit > 0 ? l.debit : l.credit) * sign;
                  return (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-muted">{fmtDate(e.date)}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-heading">{e.reference}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted">{e.voucherType}</td>
                      <td className="px-4 py-2 text-ink">{e.party?.name ?? e.partyName ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted">{e.party?.trn ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted">{l.vatTreatment}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(taxable)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">{n(taxOn(l.vatTreatment, taxable))}</td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>

      {untreated.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {untreated.length} voucher{untreated.length === 1 ? "" : "s"} in this period have no VAT treatment on any
          line — {untreated.map((e) => e.reference).slice(0, 6).join(", ")}
          {untreated.length > 6 ? "…" : ""}. Set a treatment if they belong on the return.
        </p>
      )}
    </div>
  );
}
