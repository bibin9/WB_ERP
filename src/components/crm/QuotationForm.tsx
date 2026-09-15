"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveQuotation } from "@/app/(app)/crm/quotations/actions";

/**
 * Raising a quotation from an estimate (CRM-13).
 *
 * There is no price box. The whole point of having built the estimate up is
 * that the price comes from it — a quotation with a typed total is a number
 * somebody remembered, and the build-up behind it becomes decoration.
 */
export default function QuotationForm({
  companyId,
  estimates,
}: {
  companyId: string;
  estimates: { id: string; number: string; title: string; customerName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [estimateId, setEstimateId] = useState("");

  const chosen = estimates.find((e) => e.id === estimateId);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Raise a quotation
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Which estimate is it priced from?</h2>
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
            const res = await saveQuotation(fd);
            setBusy(false);
            if (res?.ok) { setOpen(false); setEstimateId(""); }
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          {estimates.length === 0 ? (
            <p className="text-sm text-muted">
              There are no estimates to quote from yet. Price one first — the quotation takes its total from the
              estimate rather than asking for a figure.
            </p>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Estimate</label>
                <select
                  name="estimateId" className="input" required
                  value={estimateId} onChange={(e) => setEstimateId(e.target.value)}
                >
                  <option value="">Choose&hellip;</option>
                  {estimates.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.number} — {e.title}
                      {e.customerName ? ` — ${e.customerName}` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  The price comes from here. There is no box to type one, on purpose.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Title on the quotation</label>
                <input name="title" className="input" placeholder={chosen?.title ?? "Follows the estimate"} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Customer</label>
                  <input
                    name="customerName" className="input"
                    placeholder={chosen?.customerName || "From the enquiry"}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Price held until</label>
                  <input type="date" name="validUntil" className="input" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Terms</label>
                <textarea
                  name="terms" className="input" rows={3}
                  placeholder="Payment terms, exclusions, what the price does not cover"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
                <input name="notes" className="input" placeholder="For us, not for the customer" />
              </div>

              <p className="rounded bg-brand-paper p-3 text-xs text-muted">
                It saves as a draft. Nothing reaches the customer until management has signed it.
              </p>
            </>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy || !estimates.length} className="btn-primary disabled:opacity-50">
              {busy ? "Raising…" : "Raise it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
