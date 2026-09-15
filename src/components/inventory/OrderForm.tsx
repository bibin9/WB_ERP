"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { saveOrder } from "@/app/(app)/inventory/actions";
import { money } from "@/lib/money";
import { orderTotal } from "@/lib/purchasing";

type Line = { key: number; itemId: string; description: string; unitCode: string; quantity: string; unitPrice: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, itemId: "", description: "", unitCode: "EA", quantity: "", unitPrice: "" });

export type PrefillRequest = {
  id: string;
  number: string;
  jobId: string | null;
  storeId: string | null;
  lines: { itemId: string | null; description: string; unitCode: string; quantity: number; unitPrice: number }[];
};

/**
 * Raising an order (INV-05).
 *
 * Arriving from an approved material request, its lines come through already
 * filled in and priced at the standard cost. Re-typing what site already wrote
 * is where quantities change by accident, and the request is the document that
 * was actually approved.
 */
export default function OrderForm({
  companyId,
  parties,
  items,
  jobs,
  stores,
  fromRequest,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string }[];
  items: { id: string; code: string; name: string; unitCode: string; standardCost: number }[];
  jobs: { id: string; code: string; name: string }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  fromRequest?: PrefillRequest | null;
}) {
  const [open, setOpen] = useState(!!fromRequest);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    fromRequest?.lines.length
      ? fromRequest.lines.map((l) => ({
          key: nextKey++,
          itemId: l.itemId ?? "",
          description: l.description,
          unitCode: l.unitCode,
          quantity: String(l.quantity),
          unitPrice: l.unitPrice ? String(l.unitPrice) : "",
        }))
      : [blank()],
  );

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    set(key, {
      itemId,
      description: item ? `${item.code} — ${item.name}` : "",
      unitCode: item?.unitCode ?? "EA",
      ...(item?.standardCost ? { unitPrice: String(item.standardCost) } : {}),
    });
  };

  const total = orderTotal(
    lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })),
  );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Raise an order
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">
            Raise a purchase order{fromRequest ? ` from ${fromRequest.number}` : ""}
          </h2>
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
            setSaving(true);
            fd.set("lines", JSON.stringify(lines.filter((l) => l.description.trim() && Number(l.quantity) > 0)));
            const res = await saveOrder(fd);
            setSaving(false);
            if (res?.ok) {
              setOpen(false);
              setLines([blank()]);
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />
          {fromRequest && <input type="hidden" name="requestId" value={fromRequest.id} />}

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            An order commits money but posts nothing to the accounts. Nothing is owed until material arrives. It
            saves as a draft, and goes to the supplier only once it has been approved.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Supplier</label>
              <select name="partyId" className="input" required>
                <option value="">Choose&hellip;</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Job</label>
              <select name="jobId" className="input" defaultValue={fromRequest?.jobId ?? ""}>
                <option value="">Not for a particular job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Order date</label>
              <input type="date" name="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Promised by</label>
              <input type="date" name="expectedDate" className="input" />
              <p className="mt-1 text-xs text-muted">Leave empty if nothing was promised.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Deliver to</label>
              <select name="storeId" className="input" defaultValue={fromRequest?.storeId ?? stores.find((s) => s.isDefault)?.id ?? ""}>
                <option value="">Not decided</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">What is being ordered</span>
              <span className="text-sm font-semibold tabular-nums text-heading">{money(total)}</span>
            </div>
            <div className="space-y-2 p-3">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <select className="input h-9 py-1.5 text-sm" value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)}>
                      <option value="">Not a catalogue item&hellip;</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      className="input h-9 py-1.5 text-sm"
                      value={l.description}
                      onChange={(e) => set(l.key, { description: e.target.value })}
                      placeholder="Describe it"
                    />
                  </div>
                  <div className="col-span-1">
                    <input className="input h-9 py-1.5 text-sm" value={l.unitCode} onChange={(e) => set(l.key, { unitCode: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.001" min="0" className="input h-9 py-1.5 text-sm"
                      value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} placeholder="Qty"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.01" min="0" className="input h-9 py-1.5 text-sm"
                      value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} placeholder="Price"
                    />
                  </div>
                  <div className="col-span-1 flex items-center">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
                        title="Remove this line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, blank()])}
                className="text-xs text-brand-blue-600 hover:underline"
              >
                Add another line
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" placeholder="Delivery instructions, terms, anything the supplier needs" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving…" : "Save as draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
