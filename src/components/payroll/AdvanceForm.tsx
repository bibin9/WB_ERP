"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createAdvance } from "@/app/(app)/hr/payroll/actions";

type Emp = { id: string; label: string };

export default function AdvanceForm({ companyId, employees }: { companyId: string; employees: Emp[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-navy" onClick={() => setOpen(true)} disabled={!companyId || employees.length === 0}><Plus className="h-4 w-4" /> New advance</button>;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-20">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-brand-navy">New Salary Advance</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form action={async (fd) => { await createAdvance(fd); setOpen(false); }} className="space-y-4 p-5">
          <input type="hidden" name="companyId" value={companyId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Employee</label>
            <select name="employeeId" className="input" required>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Advance amount (AED)</label>
              <input name="amount" type="number" step="0.01" min="0" className="input" placeholder="0.00" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Monthly recovery (AED)</label>
              <input name="monthlyRecovery" type="number" step="0.01" min="0" className="input" placeholder="0.00" required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Reason (optional)</label>
            <input name="reason" className="input" placeholder="e.g. Ramadan advance" />
          </div>
          <p className="text-[11px] text-muted">The monthly amount is deducted from each payroll run and the balance reduces when the run is marked Paid.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Record advance</button>
          </div>
        </form>
      </div>
    </div>
  );
}
