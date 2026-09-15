"use client";

import { useState } from "react";
import { Percent, X, ArrowRight } from "lucide-react";
import { setEstimateBasis } from "@/app/(app)/crm/estimates/actions";
import { markupToMargin, marginToMarkup, sellFrom } from "@/lib/estimating";
import type { EstimateTotals } from "@/lib/estimating";
import { money } from "@/lib/money";

/**
 * Overheads and the margin (CRM-06).
 *
 * The two percentages are shown against each other live, because this is the
 * one dialog where the markup-and-margin confusion actually costs money. An
 * estimator typing 20 sees immediately whether they are about to get a fifth
 * of the price or a sixth of it, and the other number is right beside it.
 */
export default function BasisForm({
  estimate,
  totals,
}: {
  estimate: {
    id: string;
    overheadPct: number;
    fixedCosts: number;
    basisKind: string;
    basisValue: number;
    acceptLoss: boolean;
  };
  totals: EstimateTotals;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [overhead, setOverhead] = useState(String(estimate.overheadPct * 100));
  const [fixed, setFixed] = useState(String(estimate.fixedCosts || ""));
  const [kind, setKind] = useState(estimate.basisKind);
  const [value, setValue] = useState(String(estimate.basisValue * 100));

  const pct = Math.max(0, Number(overhead) || 0) / 100;
  const indirect = totals.direct * pct + (Number(fixed) || 0);
  const cost = totals.direct + indirect;

  const entered = (Number(value) || 0) / 100;
  const asMargin = kind === "margin" ? entered : markupToMargin(entered);
  const asMarkup = kind === "margin" ? marginToMarkup(entered) : entered;
  const sell = kind === "margin" ? sellFrom(cost, { margin: entered }) : sellFrom(cost, { markup: entered });
  const profit = sell - cost;

  const show = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">
        <Percent className="h-4 w-4" /> Overheads &amp; margin
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What goes on top?</h2>
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
            const res = await setEstimateBasis(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="estimateId" value={estimate.id} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Overhead %</label>
              <input
                type="number" step="0.1" min="0" name="overheadPct" className="input"
                value={overhead} onChange={(e) => setOverhead(e.target.value)} placeholder="10"
              />
              <p className="mt-1 text-xs text-muted">Site supervision, temporary works, the office.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Fixed costs</label>
              <input
                type="number" step="0.01" min="0" name="fixedCosts" className="input"
                value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="0.00"
              />
              <p className="mt-1 text-xs text-muted">Bonds, insurance, mobilisation.</p>
            </div>
          </div>

          <div className="rounded bg-brand-paper p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Direct cost</span>
              <span className="tabular-nums text-ink">{money(totals.direct)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Plus overhead</span>
              <span className="tabular-nums text-ink">{money(indirect)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-line pt-1">
              <span className="font-medium text-ink">What the work costs</span>
              <span className="font-medium tabular-nums text-ink">{money(cost)}</span>
            </div>
            <p className="mt-1.5 text-muted">
              The margin goes on after this, never before — the other way round and the overhead comes straight
              back out of the profit.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Add a</label>
              <select name="basisKind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
                <option value="markup">Markup — a share of the cost</option>
                <option value="margin">Margin — a share of the price</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Of</label>
              <input
                type="number" step="0.1" name="basisValue" className="input"
                value={value} onChange={(e) => setValue(e.target.value)} placeholder="20"
              />
            </div>
          </div>

          {/* The whole reason this dialog exists. */}
          <div className="rounded border border-line p-3">
            <div className="flex items-center justify-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-muted">Margin</div>
                <div className="text-lg font-semibold tabular-nums text-heading">{show(asMargin)}</div>
                <div className="text-xs text-muted">of the price</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted" />
              <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-muted">Markup</div>
                <div className="text-lg font-semibold tabular-nums text-heading">{show(asMarkup)}</div>
                <div className="text-xs text-muted">on the cost</div>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              They are different numbers. Whichever you typed, this is what the other one is.
            </p>
          </div>

          <div className="flex items-center justify-between rounded bg-brand-paper p-3">
            <span className="text-sm text-muted">Quote</span>
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums text-heading">{money(sell)}</div>
              <div className={`text-xs tabular-nums ${profit < 0 ? "text-brand-gold" : "text-muted"}`}>
                {money(profit)} profit
              </div>
            </div>
          </div>

          {profit < 0 && (
            <label className="flex items-start gap-2 rounded bg-brand-gold/10 p-3 text-sm">
              <input type="checkbox" name="acceptLoss" className="mt-0.5" defaultChecked={estimate.acceptLoss} />
              <span>
                <span className="font-medium text-ink">This is deliberately below cost</span>
                <span className="mt-0.5 block text-xs text-muted">
                  A loss leader is a decision somebody is allowed to make, once they have said so. Without this
                  the estimate cannot be marked ready to quote from.
                </span>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
