"use client";

import { useState } from "react";
import { releaseRetention } from "@/app/(app)/finance/retention/actions";

/**
 * Releasing retention.
 *
 * Its own confirmation rather than an inline button, because it posts: the
 * amount stops being retention and becomes an ordinary receivable or payable,
 * which is what makes it start appearing in ageing and getting chased. Whoever
 * clicks it should see what it will do and pick the date.
 */
export default function ReleaseRetention({
  id,
  reference,
  amount,
  direction,
  releasable,
}: {
  id: string;
  reference: string;
  amount: string;
  direction: string;
  /** Its due date has passed — otherwise this is early, which is allowed but worth saying. */
  releasable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const receivable = direction === "Receivable";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`rounded px-2 py-1 text-xs ${releasable ? "font-medium text-brand-green-700 hover:bg-line" : "text-muted hover:bg-line"}`}
        title={releasable ? "This is due — release it" : "Release before its due date"}
      >
        Release
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-24 whitespace-normal text-left">
      <div className="card w-full max-w-sm p-5">
        <h2 className="font-semibold text-heading">Release retention</h2>
        <p className="mt-1 text-sm text-ink">
          {amount} on <span className="font-mono text-xs">{reference}</span>
        </p>

        {!releasable && (
          <p className="mt-3 rounded bg-brand-gold/10 p-2 text-xs text-ink">
            This is not due yet. Releasing early is allowed &mdash; the contract may have been settled sooner &mdash;
            but check before you do.
          </p>
        )}

        <p className="mt-3 rounded bg-brand-paper p-3 text-xs text-muted">
          {receivable ? (
            <>
              This moves the money out of retention and into what the client owes you normally, so it starts showing
              in Outstanding and can be chased. It does not record a payment.
            </>
          ) : (
            <>
              This moves the money out of retention and into what you owe the subcontractor normally, so it shows in
              Outstanding and can be paid. It does not pay them.
            </>
          )}
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink">Date of release</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </div>

        {error && <p className="mt-3 text-sm text-brand-gold">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button
            disabled={busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              const res = await releaseRetention(id, date);
              setBusy(false);
              if (res.ok) setOpen(false);
              else setError(res.error || "Could not release");
            }}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? "Releasing…" : "Release"}
          </button>
        </div>
      </div>
    </div>
  );
}
