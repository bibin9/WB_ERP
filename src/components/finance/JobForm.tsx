"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createJob, updateJobRecord } from "@/app/(app)/finance/jobs/actions";

const STATUSES = ["Open", "On hold", "Completed", "Closed"];

export type EditingJob = {
  id: string;
  code: string;
  name: string;
  partyId: string | null;
  contractValue: number;
  budgetCost: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  notes: string | null;
};

export default function JobForm({
  companyId,
  parties,
  job,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string }[];
  job?: EditingJob;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = !!job;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="btn-primary">
      <Plus className="h-4 w-4" /> New job
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `Edit ${job!.code}` : "New job"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateJobRecord(fd) : await createJob(fd);
            setSaving(false);
            if (res?.ok) { setOpen(false); } else { setError(res?.error || "Could not save"); }
          }}
          className="space-y-4 p-5"
        >
          {editing ? <input type="hidden" name="id" value={job!.id} /> : <input type="hidden" name="companyId" value={companyId} />}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input" defaultValue={job?.code ?? ""} placeholder="auto" disabled={editing} />
              {!editing && <p className="mt-1 text-xs text-muted">Leave blank to number it for you.</p>}
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Job name</label>
              <input name="name" className="input" defaultValue={job?.name ?? ""} placeholder="ADNOC pipeline fabrication" required />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Customer</label>
            <select name="partyId" className="input" defaultValue={job?.partyId ?? ""}>
              <option value="">— none —</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Contract value</label>
              <input name="contractValue" type="number" step="0.01" min="0" className="input" defaultValue={job?.contractValue || ""} placeholder="0.00" />
              <p className="mt-1 text-xs text-muted">What the job was sold for.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Budget cost</label>
              <input name="budgetCost" type="number" step="0.01" min="0" className="input" defaultValue={job?.budgetCost || ""} placeholder="0.00" />
              <p className="mt-1 text-xs text-muted">What you expect it to cost you.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Start</label>
              <input name="startDate" type="date" className="input" defaultValue={job?.startDate ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">End</label>
              <input name="endDate" type="date" className="input" defaultValue={job?.endDate ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Status</label>
              <select name="status" className="input" defaultValue={job?.status ?? "Open"}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={job?.notes ?? ""} placeholder="Optional" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editing ? "Save" : "Add job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
