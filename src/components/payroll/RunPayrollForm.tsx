"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import { createPayrollRun } from "@/app/(app)/hr/payroll/actions";

export default function RunPayrollForm({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  /** Employees the gate held back, each with the reason. */
  const [notReady, setNotReady] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const thisMonth = new Date().toISOString().slice(0, 7);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)} disabled={!companyId}>
        <Play className="h-4 w-4" /> Run payroll
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-24 whitespace-normal text-left">
      <div className="card w-full max-w-sm p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Run Payroll</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => {
            setError("");
            setNotReady([]);
            setSaving(true);
            const res = await createPayrollRun(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else {
              setError(res?.error || "Failed");
              setNotReady(res?.notReady ?? []);
            }
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Pay period (month)</label>
            <input type="month" name="period" className="input" defaultValue={thisMonth} required />
            <p className="mt-1 text-xs text-muted">
              A payslip for everyone employed in that month. Overtime comes from the muster, part months
              from the join and last working dates, and unpaid days from approved leave &mdash; so nothing
              is keyed twice.
            </p>
          </div>
          {error && <p className="text-sm text-brand-gold">{error}</p>}
          {notReady.length > 0 && (
            <div className="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3">
              <ul className="space-y-1 text-xs text-ink">
                {notReady.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                A record missing any of these cannot go in the bank&rsquo;s WPS file. The bank rejects the
                whole file on one bad row, so the run is stopped here rather than at the bank.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Working…" : "Generate payslips"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
