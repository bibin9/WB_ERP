"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveEstimate } from "@/app/(app)/crm/estimates/actions";
import { markupToMargin, marginToMarkup } from "@/lib/estimating";

/**
 * Starting an estimate.
 *
 * The overhead and the margin are asked for up front because they are the two
 * things nobody remembers to go back and set, and an estimate with neither
 * quietly prices the work at cost.
 */
export default function EstimateForm({
  companyId,
  leads,
}: {
  companyId: string;
  leads: { id: string; number: string; title: string; customerName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("markup");
  const [value, setValue] = useState("20");

  const entered = (Number(value) || 0) / 100;
  const asMargin = kind === "margin" ? entered : markupToMargin(entered);
  const asMarkup = kind === "margin" ? marginToMarkup(entered) : entered;
  const show = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Start an estimate
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What is being priced?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await saveEstimate(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What it is for</label>
            <input name="title" className="input" required placeholder="Substation fit-out, Mussafah" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Against which enquiry</label>
            <select name="leadId" className="input">
              <option value="">Not against an enquiry — a study</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{l.number} — {l.customerName} — {l.title}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Overhead %</label>
              <input type="number" step="0.1" min="0" name="overheadPct" className="input" defaultValue="10" />
              <p className="mt-1 text-xs text-muted">Of the direct cost, added before the margin.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Fixed costs</label>
              <input type="number" step="0.01" min="0" name="fixedCosts" className="input" placeholder="0.00" />
              <p className="mt-1 text-xs text-muted">Bonds, insurance, mobilisation.</p>
            </div>
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
                value={value} onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>

          <p className="rounded bg-brand-paper p-3 text-center text-xs text-muted">
            That is a <span className="font-medium text-ink">{show(asMargin)} margin</span> and a{" "}
            <span className="font-medium text-ink">{show(asMarkup)} markup</span>. They are different numbers, and
            both are shown everywhere so nobody quotes one meaning the other.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" placeholder="Assumptions, exclusions, what it is based on" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Starting…" : "Start it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
