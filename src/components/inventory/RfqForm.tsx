"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { saveRfq } from "@/app/(app)/inventory/actions";
import ItemForm, { type CreatedItem } from "./ItemForm";
import { MIN_VENDORS } from "@/lib/rfq";

type Line = { key: number; itemId: string; description: string; unitCode: string; quantity: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, itemId: "", description: "", unitCode: "EA", quantity: "" });

/**
 * Raising an enquiry (INV-05).
 *
 * Deliberately says nothing about price. The whole point is that the buyer does
 * not know it yet — a form with a price box on it invites somebody to fill in
 * what they expect to pay, and an expectation written down before the quotes
 * arrive is an anchor rather than a fact.
 */
export default function RfqForm({
  companyId,
  items,
  jobs,
  requests,
  itemCategories = [],
  canAddItem = false,
}: {
  companyId: string;
  items: { id: string; code: string; name: string; unitCode: string; isStocked: boolean }[];
  jobs: { id: string; code: string; name: string }[];
  requests: { id: string; number: string }[];
  /** The categories already in use, for the item dialog this form can open. */
  itemCategories?: string[];
  /** Whether this person may add to the catalogue at all. */
  canAddItem?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank()]);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Which line asked for a new item; the dialog lives outside this form.
  const [addingFor, setAddingFor] = useState<number | null>(null);

  const pickItem = (key: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    set(key, {
      itemId,
      description: item ? `${item.code} — ${item.name}` : "",
      unitCode: item?.unitCode ?? "EA",
    });
  };

  const filled = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Raise an enquiry
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What do you want prices for?</h2>
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
            fd.set("lines", JSON.stringify(filled));
            const res = await saveRfq(fd);
            setSaving(false);
            if (res?.ok) {
              setOpen(false);
              setLines([blank()]);
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Ask what the work needs, not what you expect to pay — there is no price box here on purpose. Once it is
            raised you invite suppliers, and at least {MIN_VENDORS} have to be asked before it can be awarded.
          </p>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date</label>
              <input
                type="date" name="date" className="input" required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Needed by</label>
              <input type="date" name="neededBy" className="input" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Job</label>
              <select name="jobId" className="input">
                <option value="">Not for a particular job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">From request</label>
              <select name="requestId" className="input">
                <option value="">Not from a request</option>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>{r.number}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              What to ask for
            </div>
            <div className="space-y-2 p-3">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <select
                      className="input h-9 py-1.5 text-sm"
                      value={l.itemId}
                      onChange={(e) => pickItem(l.key, e.target.value)}
                    >
                      <option value="">Something not in the catalogue&hellip;</option>
                      <optgroup label="Stock items">
                        {items.filter((i) => i.isStocked).map((i) => (
                          <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                        ))}
                      </optgroup>
                      {items.some((i) => !i.isStocked) && (
                        <optgroup label="Services — never stocked">
                          {items.filter((i) => !i.isStocked).map((i) => (
                            <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {canAddItem && (
                      <button
                        type="button"
                        onClick={() => setAddingFor(l.key)}
                        className="mt-1 text-xs font-medium text-brand-blue-600 hover:underline"
                        title="Not in the catalogue yet? Add it without losing what you have typed"
                      >
                        + New item
                      </button>
                    )}
                  </div>
                  <div className="col-span-4">
                    <input
                      className="input h-9 py-1.5 text-sm"
                      value={l.description}
                      onChange={(e) => set(l.key, { description: e.target.value })}
                      placeholder="Describe it"
                    />
                  </div>
                  <div className="col-span-1">
                    <input
                      className="input h-9 py-1.5 text-sm"
                      value={l.unitCode}
                      onChange={(e) => set(l.key, { unitCode: e.target.value })}
                      placeholder="EA"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.001" min="0"
                      className="input h-9 py-1.5 text-sm"
                      value={l.quantity}
                      onChange={(e) => set(l.key, { quantity: e.target.value })}
                      placeholder="Qty"
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
            <input name="notes" className="input" placeholder="Anything the suppliers need to know" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving || !filled.length} className="btn-primary disabled:opacity-50">
              {saving ? "Raising…" : "Raise the enquiry"}
            </button>
          </div>
        </form>
      </div>
      {/* Outside the form above: a form element cannot be nested inside
          another. What it creates lands on the line that asked for it. */}
      {addingFor !== null && (
        <ItemForm
          companyId={companyId}
          categories={itemCategories}
          inline
          controlled
          onClose={() => setAddingFor(null)}
          onCreated={(item: CreatedItem) => {
            set(addingFor, {
              itemId: item.id,
              description: `${item.code} — ${item.name}`,
              unitCode: item.unitCode,
            });
            setAddingFor(null);
          }}
        />
      )}
    </div>
  );
}
