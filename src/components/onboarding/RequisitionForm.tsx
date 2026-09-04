"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createRequisition } from "@/app/(app)/hr/onboarding/actions";

export default function RequisitionForm({ companyId, departments = [], designations = [] }: { companyId: string; departments?: string[]; designations?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)} disabled={!companyId}><Plus className="h-4 w-4" /> New requisition</button>;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-20">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-brand-navy">New Requisition</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form action={async (fd) => { await createRequisition(fd); setOpen(false); }} className="space-y-4 p-5">
          <input type="hidden" name="companyId" value={companyId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Position</label>
            <input name="position" list="req-designations" className="input" placeholder="Select or type a designation" required />
            <datalist id="req-designations">{designations.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Department</label>
              <select name="department" className="input" defaultValue="">
                <option value="">Select…</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Headcount</label>
              <input name="headcount" type="number" className="input" defaultValue={1} min={1} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}
