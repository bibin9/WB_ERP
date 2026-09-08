"use client";

import { useState } from "react";
import { setChequeStatus } from "@/app/(app)/finance/cheques/actions";
import { NEXT_STATUS, STATUS_HELP, type ChequeStatus as Status } from "@/lib/cheques";

/**
 * Moving a cheque along.
 *
 * Only the statuses that can legitimately follow the current one are offered,
 * so the register cannot record a cheque going from cleared back to in hand.
 * Clearing asks for a date and warns that it posts, because it is the only one
 * of these that writes to the ledger.
 */
export default function ChequeStatusControl({
  id,
  status,
  chequeNo,
  amount,
}: {
  id: string;
  status: string;
  chequeNo: string;
  amount: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Status | "">("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const options = (NEXT_STATUS[status as Status] ?? []) as Status[];
  if (options.length === 0) return <span className="text-xs text-muted">&mdash;</span>;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded px-2 py-1 text-xs text-brand-blue-600 hover:bg-line">
        Update
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-24 whitespace-normal text-left">
      <div className="card w-full max-w-sm p-5">
        <h2 className="font-semibold text-heading">Cheque {chequeNo}</h2>
        <p className="mt-1 text-xs text-muted">
          {amount} &middot; currently {status.toLowerCase()}
        </p>

        <div className="mt-4 space-y-2">
          {options.map((o) => (
            <label
              key={o}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                choice === o ? "border-brand-blue bg-brand-blue/5" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="next"
                className="mt-0.5"
                checked={choice === o}
                onChange={() => setChoice(o)}
              />
              <span>
                <span className="font-medium text-ink">{o}</span>
                <span className="block text-xs text-muted">{STATUS_HELP[o]}</span>
              </span>
            </label>
          ))}
        </div>

        {choice && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-ink">
              {choice === "Cleared" ? "Date the bank paid it" : "Date"}
            </label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            {choice === "Cleared" && (
              <p className="mt-2 rounded bg-brand-paper p-2 text-xs text-muted">
                This is the one that touches your accounts. It posts a {status === "Deposited" || status === "In hand" ? "" : ""}
                voucher on that date moving the money between the bank and the customer or supplier.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-brand-gold">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button
            disabled={!choice || busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              const res = await setChequeStatus(id, choice as string, date);
              setBusy(false);
              if (res.ok) setOpen(false);
              else setError(res.error || "Could not update");
            }}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
