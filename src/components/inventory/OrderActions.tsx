"use client";

import { useState } from "react";
import { sendOrderForApproval, callOffOrder, receiveOrderLine } from "@/app/(app)/inventory/actions";
import { binLabel } from "@/lib/bins";

/**
 * The three things that happen to an order after it is written.
 *
 * Receiving gets its own dialog rather than an inline field, because it is the
 * one that moves stock and money, and because the quantity outstanding has to
 * be visible at the moment somebody types a figure against it.
 */
export default function OrderActions(props: {
  mode: "submit" | "cancel" | "receive";
  orderId?: string;
  orderLineId?: string;
  label: string;
  outstanding?: number;
  unitCode?: string;
  stores?: { id: string; code: string; name: string; isDefault: boolean }[];
  /** The bins in each store, keyed by store id. Absent means the store has none. */
  bins?: Record<string, { id: string; code: string; zone: string | null; materialType: string | null }[]>;
  defaultStoreId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState("");
  const [storeId, setStoreId] = useState(props.defaultStoreId ?? props.stores?.[0]?.id ?? "");

  // A store divided into bins refuses a movement that does not name one, and
  // the main store is both the one most likely to be binned and the one orders
  // are received into. Without this the delivery was refused at the counter.
  const storeBins = (props.bins ?? {})[storeId] ?? [];

  const { mode, label, outstanding = 0, unitCode = "" } = props;
  const over = Number(quantity) > outstanding;

  if (mode !== "receive") {
    const send = mode === "submit";
    return (
      <>
        <button
          disabled={busy}
          onClick={async () => {
            setError("");
            setBusy(true);
            const res = send
              ? await sendOrderForApproval(props.orderId!)
              : await callOffOrder(props.orderId!);
            setBusy(false);
            if (!res.ok) setError(res.error || "Could not do that");
          }}
          className={send ? "btn-primary disabled:opacity-50" : "btn-ghost disabled:opacity-50"}
        >
          {busy ? "Working…" : send ? "Send for approval" : "Cancel this order"}
        </button>
        {error && <span className="self-center text-xs text-brand-gold">{error}</span>}
      </>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-line"
      >
        Record delivery
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-24 whitespace-normal text-left">
      <div className="card w-full max-w-sm p-5">
        <h2 className="font-semibold text-heading">Record a delivery</h2>
        <p className="mt-1 text-sm text-ink">{label}</p>
        <p className="mt-1 text-xs text-muted">
          <span className="font-medium text-ink">{outstanding.toLocaleString()} {unitCode}</span> still outstanding
        </p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setError("");
            setBusy(true);
            const res = await receiveOrderLine(fd);
            setBusy(false);
            if (res.ok) setOpen(false);
            else setError(res.error || "Could not record it");
          }}
          className="mt-4 space-y-3"
        >
          <input type="hidden" name="orderLineId" value={props.orderLineId} />

          <p className="rounded bg-brand-paper p-2 text-xs text-muted">
            Priced from the order, so there is nothing to type. What was agreed is what the material is worth until
            the supplier&rsquo;s invoice says otherwise.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">How much arrived</label>
              <input
                type="number" step="0.001" min="0" name="quantity"
                value={quantity} onChange={(e) => setQuantity(e.target.value)}
                className="input" required
              />
              {over && (
                <p className="mt-1 text-xs text-brand-gold">
                  Only {outstanding.toLocaleString()} is outstanding.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date</label>
              <input type="date" name="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Into which store</label>
            <select
              name="storeId" className="input" required
              value={storeId} onChange={(e) => setStoreId(e.target.value)}
            >
              {(props.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>

          {storeBins.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Which bin</label>
              <select name="binId" className="input" required defaultValue="">
                <option value="">Choose a bin&hellip;</option>
                {storeBins.map((b) => (
                  <option key={b.id} value={b.id}>{binLabel(b)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                This store is divided into bins, so the delivery has to say where it was put away.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Delivery note</label>
            <input name="reference" className="input" placeholder="The supplier's note number" required />
          </div>

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
