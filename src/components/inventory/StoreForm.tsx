"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveStore } from "@/app/(app)/inventory/actions";
import { STORE_KINDS, STORE_KIND_HELP } from "@/lib/bins";

export type EditingStore = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  kind: string;
  isDefault: boolean;
  isActive: boolean;
};

/** A place stock sits: the main store, a site container, a van. */
export type CreatedStore = { id: string; code: string; name: string; isDefault: boolean };

export default function StoreForm({
  companyId,
  row,
  /** Opened from inside another form, which holds the open state itself. */
  controlled = false,
  onClose,
  onCreated,
}: {
  companyId: string;
  row?: EditingStore;
  controlled?: boolean;
  onClose?: () => void;
  onCreated?: (store: CreatedStore) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? true : ownOpen;
  const setOpen = (next: boolean) => {
    if (controlled) { if (!next) onClose?.(); return; }
    setOwnOpen(next);
  };
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState(row?.kind ?? "Main store");
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
        <Plus className="h-4 w-4" /> Add store
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `${row!.code} — ${row!.name}` : "Add a store"}</h2>
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
            const res = await saveStore(fd);
            setSaving(false);
            if (res?.ok) { setOpen(false); if (res.store && onCreated) onCreated(res.store); }
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? <input type="hidden" name="id" value={row!.id} /> : <input type="hidden" name="companyId" value={companyId} />}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input font-mono" defaultValue={row?.code ?? ""} placeholder="MAIN" required />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Name</label>
              <input name="name" className="input" defaultValue={row?.name ?? ""} placeholder="Main store, Sharjah" required />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What kind of place</label>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
              {STORE_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{STORE_KIND_HELP[kind]}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Where it is</label>
            <input name="location" className="input" defaultValue={row?.location ?? ""} placeholder="optional" />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="isDefault" className="mt-0.5" defaultChecked={row?.isDefault ?? false} />
            <span>
              <span className="font-medium text-ink">Use this one by default</span>
              <span className="mt-0.5 block text-xs text-muted">
                The store a movement form opens on, so the usual case needs no thought. Only one can be the default.
              </span>
            </span>
          </label>

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
