"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { saveRequest } from "@/app/(app)/inventory/actions";

type Line = { key: number; itemId: string; description: string; unitCode: string; quantity: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, itemId: "", description: "", unitCode: "EA", quantity: "" });

/**
 * Site saying what the work needs (INV-01).
 *
 * A line can name a catalogue item or describe something that is not in it
 * yet. Forcing site to pick from a list they cannot add to is how requests
 * stop being raised at all, and the catalogue grows from what is actually
 * asked for rather than from what somebody guessed in advance.
 */
export default function RequestForm({
  companyId,
  items,
  jobs,
  stores,
}: {
  companyId: string;
  items: { id: string; code: string; name: string; unitCode: string }[];
  jobs: { id: string; code: string; name: string }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank()]);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    set(key, {
      itemId,
      description: item ? `${item.code} — ${item.name}` : "",
      unitCode: item?.unitCode ?? "EA",
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Raise a request
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What does the work need?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            fd.set("lines", JSON.stringify(lines.filter((l) => l.description.trim() && Number(l.quantity) > 0)));
            const res = await saveRequest(fd);
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
            Saving this sends it for approval: site in-charge, then the project manager, then procurement. It is
            checked against what is already in the store first, so nothing is bought that is sitting on a shelf.
          </p>

          <div className="grid grid-cols-3 gap-3">
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
              <label className="mb-1 block text-sm font-medium text-ink">Deliver to</label>
              <select name="storeId" className="input" defaultValue={stores.find((s) => s.isDefault)?.id ?? ""}>
                <option value="">Not decided</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Needed by</label>
              <input type="date" name="neededBy" className="input" />
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              What is needed
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
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                      ))}
                    </select>
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
            <input name="notes" className="input" placeholder="Anything the buyer needs to know" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Sending…" : "Send for approval"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
