"use client";

import { useState, useTransition } from "react";
import { Undo2, X } from "lucide-react";
import { reverseJournalEntry } from "@/app/(app)/finance/actions";

/**
 * Corrects a posted voucher by posting its opposite. Posted entries are never
 * edited or deleted, so this is how a mistake gets fixed without the audit
 * trail losing what actually happened.
 */
export default function ReverseVoucher({
  entryId,
  reference,
  reversedBy,
  minDate,
}: {
  entryId: string;
  reference: string;
  reversedBy?: string | null;
  minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  if (reversedBy) {
    return (
      <span className="whitespace-nowrap text-xs text-muted" title={`Reversed by ${reversedBy}`}>
        Reversed
      </span>
    );
  }

  function go() {
    setMsg("");
    start(async () => {
      const r = await reverseJournalEntry(entryId, date);
      if (r.ok) setOpen(false);
      else setMsg(r.error || "Could not reverse");
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Reverse this voucher"
        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-brand-blue-600"
      >
        <Undo2 className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-24">
          <div className="card w-full max-w-sm p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold text-heading">Reverse {reference}</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted">
                This posts the opposite entry — every debit becomes a credit and every credit a debit.
                The original voucher stays exactly as it is, and the two are linked.
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Reversal date</label>
                <input type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} className="input" />
                <p className="mt-1 text-xs text-muted">Usually today, or the date of the month you are correcting.</p>
              </div>
              {msg && <p className="text-sm text-brand-gold">{msg}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
                <button onClick={go} disabled={pending} className="btn-primary">
                  {pending ? "Posting…" : "Post reversal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
