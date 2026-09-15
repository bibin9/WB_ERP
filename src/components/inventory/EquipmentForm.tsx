"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveEquipment } from "@/app/(app)/inventory/actions";
import { EQUIPMENT_STATUSES, EQUIPMENT_STATUS_HELP } from "@/lib/calibration";

export type EditingEquipment = {
  id: string;
  serialNo: string;
  description: string;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  status: string;
  requiresCalibration: boolean;
  calibrationMonths: number;
  storeId: string | null;
  jobId: string | null;
  heldBy: string | null;
  notes: string | null;
  isActive: boolean;
};

/**
 * One tool or instrument, by serial number.
 *
 * Whether it carries a certificate is a property of the thing, not of a policy
 * somebody applies later. A shovel never needs one; a torque wrench always
 * does, and saying so here is what makes the expiry block work on its own.
 */
export default function EquipmentForm({
  companyId,
  stores,
  jobs,
  row,
}: {
  companyId: string;
  stores: { id: string; code: string; name: string }[];
  jobs: { id: string; code: string; name: string }[];
  row?: EditingEquipment;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [needsCal, setNeedsCal] = useState(row?.requiresCalibration ?? true);
  const [status, setStatus] = useState(row?.status ?? "In service");
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
        <Plus className="h-4 w-4" /> Add equipment
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? row!.serialNo : "Add equipment"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await saveEquipment(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={row!.id} />
          ) : (
            <input type="hidden" name="companyId" value={companyId} />
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Serial number</label>
              <input name="serialNo" className="input font-mono" defaultValue={row?.serialNo ?? ""} required />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">What it is</label>
              <input
                name="description" className="input" defaultValue={row?.description ?? ""}
                placeholder="Torque wrench 40-200Nm" required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Category</label>
              <input name="category" className="input" defaultValue={row?.category ?? ""} placeholder="Instrument" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Make</label>
              <input name="manufacturer" className="input" defaultValue={row?.manufacturer ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Model</label>
              <input name="model" className="input" defaultValue={row?.model ?? ""} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Status</label>
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{EQUIPMENT_STATUS_HELP[status]}</p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-line p-3">
            <input
              type="checkbox" name="requiresCalibration" className="mt-0.5"
              checked={needsCal} onChange={(e) => setNeedsCal(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium text-ink">It carries a calibration certificate</span>
              <span className="mt-0.5 block text-xs text-muted">
                {needsCal
                  ? "It is blocked from use the day its certificate expires, with nobody having to do anything."
                  : "A shovel needs no certificate. It stays available whatever the dates say."}
              </span>
            </span>
          </label>

          {needsCal && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">A certificate normally runs for (months)</label>
              <input
                type="number" min="1" max="120" name="calibrationMonths"
                className="input" defaultValue={row?.calibrationMonths ?? 12}
              />
              <p className="mt-1 text-xs text-muted">Offered as the default when you record a calibration.</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Kept at</label>
              <select name="storeId" className="input" defaultValue={row?.storeId ?? ""}>
                <option value="">Not recorded</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">On job</label>
              <select name="jobId" className="input" defaultValue={row?.jobId ?? ""}>
                <option value="">Not on a job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Held by</label>
              <input name="heldBy" className="input" defaultValue={row?.heldBy ?? ""} placeholder="Who has it" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={row?.notes ?? ""} />
          </div>

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={row!.isActive} />
              <span className="text-ink">Still on the register</span>
            </label>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
