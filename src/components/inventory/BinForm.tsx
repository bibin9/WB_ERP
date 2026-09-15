"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveBin } from "@/app/(app)/inventory/actions";

export type EditingBin = {
  id: string;
  code: string;
  zone: string | null;
  name: string | null;
  materialType: string | null;
  notes: string | null;
  isActive: boolean;
};

/**
 * A place inside a store (INV-14).
 *
 * The form says what creating the first one will do, because it is not a
 * cosmetic addition: from that moment every movement in that store has to name
 * a bin. That is the right rule — half-binned stock stops the bin totals
 * agreeing with the shelf — but it is a surprise if nobody said so.
 */
export default function BinForm({
  storeId,
  storeCode,
  isFirst,
  row,
}: {
  storeId: string;
  storeCode: string;
  isFirst?: boolean;
  row?: EditingBin;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = !!row;

  if (!open) {
    return editing ? (
      <button
        onClick={() => setOpen(true)}
        title="Edit"
        className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-line hover:text-ink"
      >
        <Pencil className="h-3 w-3" />
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        <Plus className="h-3 w-3" /> Add bin
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">
            {editing ? `Bin ${row!.code} in ${storeCode}` : `Add a bin to ${storeCode}`}
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
            const res = await saveBin(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={row!.id} />
          ) : (
            <input type="hidden" name="storeId" value={storeId} />
          )}

          {isFirst && !editing && (
            <p className="rounded bg-brand-gold/10 p-3 text-xs text-ink">
              <span className="font-semibold">This is the first bin in {storeCode}.</span> From now on every
              movement in this store has to say which bin — otherwise the bin totals stop agreeing with the shelf
              and nobody can tell a missing bin from missing stock.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Zone</label>
              <input name="zone" className="input" defaultValue={row?.zone ?? ""} placeholder="B" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Bin</label>
              <input name="code" className="input font-mono" defaultValue={row?.code ?? ""} placeholder="12" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Meant for</label>
              <input
                name="materialType" className="input"
                defaultValue={row?.materialType ?? ""} placeholder="Cable"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted">
            A zone groups bins inside the store and is optional — a single container needs none. &ldquo;Meant
            for&rdquo; is matched against the item&rsquo;s category: putting something else here is flagged, never
            refused.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description</label>
            <input name="name" className="input" defaultValue={row?.name ?? ""} placeholder="Top rack, north wall" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={row?.notes ?? ""} placeholder="optional" />
          </div>

          {editing && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="isActive" className="mt-0.5" defaultChecked={row!.isActive} />
              <span>
                <span className="font-medium text-ink">Still in use</span>
                <span className="mt-0.5 block text-xs text-muted">
                  A retired bin stops being offered but keeps its history. Retiring the last one turns bins off for
                  this store.
                </span>
              </span>
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
