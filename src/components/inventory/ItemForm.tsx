"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveItem } from "@/app/(app)/inventory/actions";
import { UNIT_CODES } from "@/lib/invoice";

export type EditingItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unitCode: string;
  isStocked: boolean;
  reorderLevel: number;
  standardCost: number;
  isActive: boolean;
};

/**
 * An item.
 *
 * Units come from the same list invoice lines use, so a metre of cable bought
 * and a metre of cable billed mean the same thing. Two lists would drift, and
 * the drift would only show up on a customer's desk.
 */
export default function ItemForm({
  companyId,
  categories,
  row,
}: {
  companyId: string;
  categories: string[];
  row?: EditingItem;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stocked, setStocked] = useState(row?.isStocked ?? true);

  const editing = !!row;

  if (!open) {
    return editing ? (
      <button
        onClick={() => setOpen(true)}
        title="Edit"
        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    ) : (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Add item
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `${row!.code} — ${row!.name}` : "Add an item"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await saveItem(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? <input type="hidden" name="id" value={row!.id} /> : <input type="hidden" name="companyId" value={companyId} />}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input font-mono" defaultValue={row?.code ?? ""} placeholder="CBL-4C-16" required />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">What it is</label>
              <input name="name" className="input" defaultValue={row?.name ?? ""} placeholder="4-core 16mm armoured cable" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Category</label>
              <input name="category" className="input" defaultValue={row?.category ?? ""} list="item-categories" placeholder="Cable" />
              <datalist id="item-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Unit</label>
              <select name="unitCode" className="input" defaultValue={row?.unitCode ?? "EA"}>
                {UNIT_CODES.map((u) => (
                  <option key={u.code} value={u.code}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description</label>
            <input name="description" className="input" defaultValue={row?.description ?? ""} placeholder="optional" />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-line p-3">
            <input
              type="checkbox" name="isStocked" className="mt-0.5"
              checked={stocked} onChange={(e) => setStocked(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium text-ink">Keep stock of this</span>
              <span className="mt-0.5 block text-xs text-muted">
                {stocked
                  ? "It sits on a shelf and is counted. Receiving and issuing it move stock and the accounts."
                  : "Bought and used the same day — hire, a service, a one-off. It never appears on a stock report pretending to be there, and goes straight to cost on a supplier invoice."}
              </span>
            </span>
          </label>

          {stocked && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Reorder at</label>
                <input type="number" step="0.001" min="0" name="reorderLevel" className="input" defaultValue={row?.reorderLevel ?? 0} />
                <p className="mt-1 text-xs text-muted">Leave at nought if nobody chases it.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Standard cost</label>
                <input type="number" step="0.01" min="0" name="standardCost" className="input" defaultValue={row?.standardCost ?? 0} />
                <p className="mt-1 text-xs text-muted">For estimating only. Stock is valued at what was actually paid.</p>
              </div>
            </div>
          )}

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={row!.isActive} />
              <span className="text-ink">Still in use</span>
            </label>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
