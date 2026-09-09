"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { UNIT_CODES, DEFAULT_UNIT_CODE, lineTotals, invoiceTotals } from "@/lib/invoice";
import { VAT_TREATMENTS, type VatTreatment } from "@/lib/vat";

type Row = {
  key: string;
  description: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  discount: string;
  vatTreatment: VatTreatment;
  accountId: string;
  jobId: string;
};

const blank = (accountId: string): Row => ({
  key: Math.random().toString(36).slice(2),
  description: "", quantity: "1", unitCode: DEFAULT_UNIT_CODE, unitPrice: "",
  discount: "", vatTreatment: "Standard", accountId, jobId: "",
});

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The lines of an invoice, with the totals recomputed as they are typed.
 *
 * The same arithmetic the server will use is imported rather than reimplemented
 * here. A preview that disagrees with the posted document by a fils is worse
 * than no preview, because the person typing believes the one in front of them.
 *
 * Fields post as parallel arrays of the same name, which is how a table of rows
 * reaches a server action without inventing an encoding.
 */
export default function InvoiceLines({
  accounts,
  jobs,
  vatRate,
  initial,
  readOnly = false,
}: {
  accounts: { id: string; code: string; name: string }[];
  jobs: { id: string; code: string; name: string }[];
  /** The company's rate, as a fraction. */
  vatRate: number;
  initial?: Omit<Row, "key">[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(
    initial && initial.length > 0
      ? initial.map((r) => ({ ...r, key: Math.random().toString(36).slice(2) }))
      : [blank(accounts[0]?.id ?? "")],
  );

  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const totals = invoiceTotals(
    rows.map((r) => ({
      description: r.description,
      quantity: Number(r.quantity) || 0,
      unitCode: r.unitCode,
      unitPrice: Number(r.unitPrice) || 0,
      discount: Number(r.discount) || 0,
      vatTreatment: r.vatTreatment,
      accountId: r.accountId,
    })),
    vatRate,
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5 font-semibold">Description</th>
              <th className="w-20 px-2 py-2.5 text-right font-semibold">Qty</th>
              <th className="w-28 px-2 py-2.5 font-semibold">Unit</th>
              <th className="w-28 px-2 py-2.5 text-right font-semibold">Rate</th>
              <th className="w-24 px-2 py-2.5 text-right font-semibold">Discount</th>
              <th className="w-36 px-2 py-2.5 font-semibold">VAT</th>
              <th className="w-44 px-2 py-2.5 font-semibold">Account</th>
              <th className="w-32 px-2 py-2.5 font-semibold">Job</th>
              <th className="w-28 px-3 py-2.5 text-right font-semibold">Amount</th>
              {!readOnly && <th className="w-10 px-2 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => {
              const t = lineTotals(
                {
                  description: r.description, quantity: Number(r.quantity) || 0,
                  unitCode: r.unitCode, unitPrice: Number(r.unitPrice) || 0,
                  discount: Number(r.discount) || 0, vatTreatment: r.vatTreatment,
                },
                vatRate,
              );
              return (
                <tr key={r.key} className="align-top">
                  <td className="px-3 py-2">
                    <input
                      name="description" value={r.description} readOnly={readOnly}
                      onChange={(e) => set(r.key, { description: e.target.value })}
                      className="input h-9 py-1 text-sm" placeholder="What is being billed"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      name="quantity" value={r.quantity} readOnly={readOnly} inputMode="decimal"
                      onChange={(e) => set(r.key, { quantity: e.target.value })}
                      className="input h-9 py-1 text-right text-sm"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name="unitCode" value={r.unitCode} disabled={readOnly}
                      onChange={(e) => set(r.key, { unitCode: e.target.value })}
                      className="input h-9 py-1 text-sm"
                    >
                      {UNIT_CODES.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      name="unitPrice" value={r.unitPrice} readOnly={readOnly} inputMode="decimal"
                      onChange={(e) => set(r.key, { unitPrice: e.target.value })}
                      className="input h-9 py-1 text-right text-sm" placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      name="discount" value={r.discount} readOnly={readOnly} inputMode="decimal"
                      onChange={(e) => set(r.key, { discount: e.target.value })}
                      className="input h-9 py-1 text-right text-sm" placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name="vatTreatment" value={r.vatTreatment} disabled={readOnly}
                      onChange={(e) => set(r.key, { vatTreatment: e.target.value as VatTreatment })}
                      className="input h-9 py-1 text-sm"
                    >
                      {VAT_TREATMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name="accountId" value={r.accountId} disabled={readOnly}
                      onChange={(e) => set(r.key, { accountId: e.target.value })}
                      className="input h-9 py-1 text-sm"
                    >
                      <option value="">—</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name="lineJobId" value={r.jobId} disabled={readOnly}
                      onChange={(e) => set(r.key, { jobId: e.target.value })}
                      className="input h-9 py-1 text-sm"
                    >
                      <option value="">—</option>
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="pt-2 tabular-nums text-heading">{n(t.net)}</div>
                    {t.vat > 0 && <div className="text-xs tabular-nums text-muted">+{n(t.vat)} VAT</div>}
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                        className="mt-2 grid h-7 w-7 place-items-center rounded text-muted hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blank(accounts[0]?.id ?? "")])}
          className="m-3 flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-brand-paper"
        >
          <Plus className="h-4 w-4" /> Add line
        </button>
      )}

      <div className="border-t border-line bg-brand-paper/60 px-5 py-4">
        <div className="ml-auto max-w-sm space-y-1 text-sm">
          <Row label="Net" value={n(totals.net)} />
          {/* One row per VAT category, which is what the document has to carry
              and what makes the return provable box by box. */}
          {totals.breakdown.map((g) => (
            <Row
              key={`${g.treatment}-${g.ratePercent}`}
              label={`${g.treatment}${g.ratePercent ? ` at ${g.ratePercent}%` : ""}`}
              value={n(g.tax)}
              sub={`on ${n(g.taxable)}`}
            />
          ))}
          <div className="!mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="font-medium text-ink">Total</span>
            <span className="text-lg font-bold tabular-nums text-heading">{n(totals.gross)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted">
        {label}
        {sub && <span className="ml-1 text-xs text-muted/70">{sub}</span>}
      </span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}
