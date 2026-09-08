"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { markFiled, reopenReturn } from "@/app/(app)/finance/corporate-tax/actions";
import { money } from "@/lib/money";

/**
 * Record the filing.
 *
 * Nothing here submits anything: the return goes to the FTA through EmaraTax,
 * typed in by a person. What this captures is the date and the acknowledgement
 * number, so that the working paper behind the figure can be matched to the
 * filing it produced — and so the computation stops drifting under a number
 * that has already been declared.
 */
export default function FileTaxReturn({
  id,
  status,
  taxPayable,
  filedRef,
}: {
  id: string;
  status: string;
  taxPayable: number;
  filedRef: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (status === "Filed") {
    return (
      <button
        onClick={async () => {
          setBusy(true);
          const res = await reopenReturn(id);
          setBusy(false);
          if (!res?.ok) alert(res?.error || "Could not reopen");
        }}
        disabled={busy}
        className="btn-ghost"
        title={filedRef ? `Filed as ${filedRef}` : "Filed"}
      >
        <RotateCcw className="h-4 w-4" /> {busy ? "Reopening…" : "Reopen"}
      </button>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <CheckCircle2 className="h-4 w-4" /> Mark as filed
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Record the filing</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await markFiled(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="id" value={id} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            This does not send anything to the FTA. Submit the return in EmaraTax, then put the acknowledgement here so
            the working paper and the filing can be matched later. The tax on this computation is{" "}
            <span className="font-medium text-ink">{money(taxPayable)}</span>, payable by the same deadline.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Filed on</label>
            <input name="filedOn" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">EmaraTax reference</label>
            <input name="filedRef" className="input" placeholder="The acknowledgement number" required />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Mark as filed"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
