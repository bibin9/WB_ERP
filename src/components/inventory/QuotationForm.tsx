"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { saveQuotation } from "@/app/(app)/inventory/actions";

type QuoteLine = {
  id: string;
  description: string;
  unitCode: string;
  quantity: number;
  price: number | null;
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Typing in what one supplier came back with (INV-09).
 *
 * The running total is shown as the prices are entered, because the number the
 * supplier wrote on their quotation is the one thing that can be checked
 * against by somebody who has the paper in front of them. A total that only
 * appears after saving is a total nobody checks.
 */
export default function QuotationForm({
  rfqId,
  partyId,
  partyName,
  lines,
  delivery,
  leadTimeDays,
  validUntil,
  received,
}: {
  rfqId: string;
  partyId: string;
  partyName: string;
  lines: QuoteLine[];
  delivery: number;
  leadTimeDays: number | null;
  validUntil: string | null;
  received: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.price == null ? "" : String(l.price)])),
  );
  const [carriage, setCarriage] = useState(String(delivery || ""));

  const linesTotal = lines.reduce((s, l) => s + l.quantity * (Number(prices[l.id]) || 0), 0);
  const total = linesTotal + (Number(carriage) || 0);
  const anyPrice = lines.some((l) => prices[l.id] !== "" && !isNaN(Number(prices[l.id])));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        {received ? "Edit price" : "Enter price"}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="font-semibold text-heading">What did they quote?</h2>
            <p className="text-xs text-muted">{partyName}</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setError("");
            setBusy(true);
            fd.set(
              "prices",
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(prices)
                    .filter(([, v]) => v !== "" && !isNaN(Number(v)))
                    .map(([k, v]) => [k, Number(v)]),
                ),
              ),
            );
            const res = await saveQuotation(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="rfqId" value={rfqId} />
          <input type="hidden" name="partyId" value={partyId} />

          <div className="rounded-lg border border-line">
            <div className="grid grid-cols-12 gap-2 border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              <div className="col-span-6">Line</div>
              <div className="col-span-2 text-right">Quantity</div>
              <div className="col-span-2 text-right">Unit price</div>
              <div className="col-span-2 text-right">Line total</div>
            </div>
            <div className="space-y-2 p-3">
              {lines.map((l) => (
                <div key={l.id} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-6 text-sm text-ink">{l.description}</div>
                  <div className="col-span-2 text-right text-xs tabular-nums text-muted">
                    {l.quantity.toLocaleString()} {l.unitCode}
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.001" min="0"
                      className="input h-9 py-1.5 text-right text-sm"
                      value={prices[l.id] ?? ""}
                      onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
                      placeholder="—"
                    />
                  </div>
                  <div className="col-span-2 text-right text-sm tabular-nums text-ink">
                    {prices[l.id] === "" ? "—" : money(l.quantity * (Number(prices[l.id]) || 0))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Delivery and carriage</label>
              <input
                type="number" step="0.01" min="0" name="delivery"
                className="input" value={carriage} onChange={(e) => setCarriage(e.target.value)}
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-muted">Leave empty if it is included in the rates.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Lead time (days)</label>
              <input
                type="number" min="0" name="leadTimeDays" className="input"
                defaultValue={leadTimeDays ?? ""} placeholder="—"
              />
              <p className="mt-1 text-xs text-muted">Flagged if it misses the date site needs.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Price held until</label>
              <input type="date" name="validUntil" className="input" defaultValue={validUntil ?? ""} />
              <p className="mt-1 text-xs text-muted">Flagged once it has passed.</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded bg-brand-paper p-3">
            <span className="text-sm text-muted">Their quotation comes to</span>
            <span className="text-lg font-semibold tabular-nums text-heading">{money(total)}</span>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" placeholder="Their reference, exclusions, anything worth keeping" />
          </div>

          {received && (
            <p className="rounded bg-brand-gold/10 p-2 text-xs text-ink">
              This replaces the price already recorded for {partyName}, rather than adding to it.
            </p>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy || !anyPrice} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Save the quotation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
