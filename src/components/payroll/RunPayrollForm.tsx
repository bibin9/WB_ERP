"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import { createPayrollRun } from "@/app/(app)/hr/payroll/actions";

export default function RunPayrollForm({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const thisMonth = new Date().toISOString().slice(0, 7);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)} disabled={!companyId}>
        <Play className="h-4 w-4" /> Run payroll
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-24">
      <div className="card w-full max-w-sm p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-brand-navy">Run Payroll</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => {
            setError("");
            const res = await createPayrollRun(fd);
            if (res?.ok) setOpen(false); else setError(res?.error || "Failed");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Pay period (month)</label>
            <input type="month" name="period" className="input" defaultValue={thisMonth} required />
            <p className="mt-1 text-xs text-muted">Generates a payslip for every active employee from their salary structure.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Generate payslips</button>
          </div>
        </form>
      </div>
    </div>
  );
}
