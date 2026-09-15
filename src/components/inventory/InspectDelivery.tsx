"use client";

import { useState } from "react";
import { recordInspection } from "@/app/(app)/inventory/actions";

/**
 * Passing or failing a delivery (INV-11).
 *
 * Nothing is posted either way: the material is already on the shelf and
 * already owned. What the inspection decides is whether it can be used, and
 * that is a different question from whether it is there.
 *
 * Recorded once. Changing a pass to a fail after material has been issued would
 * rewrite a decision somebody already acted on.
 */
export default function InspectDelivery({
  movementId,
  label,
  quantity,
  unitCode,
}: {
  movementId: string;
  label: string;
  quantity: number;
  unitCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("Accepted");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        Inspect
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-24 whitespace-normal text-left">
      <div className="card w-full max-w-sm p-5">
        <h2 className="font-semibold text-heading">Inspect this delivery</h2>
        <p className="mt-1 text-sm text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{quantity.toLocaleString()} {unitCode}</p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setError("");
            setBusy(true);
            const res = await recordInspection(fd);
            setBusy(false);
            if (res.ok) setOpen(false);
            else setError(res.error || "Could not record it");
          }}
          className="mt-4 space-y-3"
        >
          <input type="hidden" name="movementId" value={movementId} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What did you find</label>
            <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input">
              <option value="Accepted">Passed — free to issue</option>
              <option value="Rejected">Failed — goes back to the supplier</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              {outcome === "Accepted"
                ? "The material becomes usable. It was already on the shelf; now it can leave it."
                : "It stays on the shelf and stays in the stock value, because it is still ours until it physically goes back. Record a return to the supplier when it does."}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="note" className="input" placeholder="Certificate number, what was wrong, who checked" />
          </div>

          <p className="rounded bg-brand-paper p-2 text-xs text-muted">
            Recorded once. Changing a pass to a fail later would rewrite a decision somebody has already acted on.
          </p>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Recording…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
