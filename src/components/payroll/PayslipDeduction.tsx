"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updatePayslip } from "@/app/(app)/hr/payroll/actions";

/**
 * The one figure on a payslip a person keys.
 *
 * Everything else — the part month, the overtime, the unpaid days — is derived
 * from the muster and the leave record. A fine or an agreed recovery is not,
 * and it is the figure a man will one day ask about, so it cannot be saved
 * without saying what it was for.
 */
export default function PayslipDeduction({
  id,
  employeeName,
  otherDeductions,
  deductionNote,
}: {
  id: string;
  employeeName: string;
  otherDeductions: number;
  deductionNote: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Add or change a deduction"
        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Deduction — {employeeName}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await updatePayslip(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="id" value={id} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Use this for a fine or an agreed recovery. Unpaid leave, sick leave and absence are already
            taken off from the muster and the leave record &mdash; if one of those looks wrong, fix it
            there so the payslip and the attendance keep agreeing.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Amount to deduct</label>
            <input
              name="otherDeductions"
              type="number"
              step="0.01"
              min="0"
              defaultValue={otherDeductions || ""}
              className="input"
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-muted">A positive number. Enter nil to remove it.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What it is for</label>
            <input
              name="deductionNote"
              defaultValue={deductionNote ?? ""}
              className="input"
              placeholder="Damaged equipment, agreed 12 Sept"
            />
            <p className="mt-1 text-xs text-muted">
              Required. In a year&rsquo;s time this note is the answer to &ldquo;why was I short?&rdquo;
            </p>
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
