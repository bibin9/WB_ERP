"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createCostCentre, updateCostCentre } from "@/app/(app)/finance/cost-centres/actions";

export type EditingCentre = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  notes: string | null;
  isActive: boolean;
};

export default function CostCentreForm({
  companyId,
  centres,
  centre,
}: {
  companyId: string;
  /** Possible parents. The one being edited is filtered out by the caller. */
  centres: { id: string; code: string; name: string }[];
  centre?: EditingCentre;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = !!centre;

  const trigger = editing ? (
    <button
      onClick={() => setOpen(true)}
      title="Edit"
      className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="btn-primary">
      <Plus className="h-4 w-4" /> New cost centre
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `Edit ${centre!.code}` : "New cost centre"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateCostCentre(fd) : await createCostCentre(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={centre!.id} />
          ) : (
            <input type="hidden" name="companyId" value={companyId} />
          )}

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            A cost centre is a part of your own business that costs money to run but that no single customer job
            pays for — the workshop, the vehicles, the head office. Tag those costs here so you can see what they
            add up to, and so a cost with no job on it stands out as something still to be tagged.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input" defaultValue={centre?.code ?? ""} placeholder="auto" disabled={editing} />
              {!editing && <p className="mt-1 text-xs text-muted">Leave blank to number it for you.</p>}
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Name</label>
              <input name="name" className="input" defaultValue={centre?.name ?? ""} placeholder="Workshop — Al Quoz" required />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Sits under</label>
            <select name="parentId" className="input" defaultValue={centre?.parentId ?? ""}>
              <option value="">— top level —</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Optional. Costs stay on the centre you post to; a parent simply adds its children up. Example: put
              &ldquo;Crane&rdquo; and &ldquo;Pickups&rdquo; under &ldquo;Vehicles&rdquo;.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={centre?.notes ?? ""} placeholder="Optional" />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="isActive"
              value="on"
              defaultChecked={centre ? centre.isActive : true}
              className="h-4 w-4 rounded border-line"
            />
            Active — show it in the list when posting a voucher
          </label>
          {/* An unticked checkbox sends nothing at all, so pair it with a hidden
              "off" the browser sends first and the checkbox overrides. */}
          <input type="hidden" name="isActive" value="off" />

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editing ? "Save" : "Add cost centre"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
