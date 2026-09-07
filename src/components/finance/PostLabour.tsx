"use client";

import { useState } from "react";
import { Clock, X } from "lucide-react";
import { postLabourToJobs } from "@/app/(app)/finance/jobs/labour-actions";
import { money } from "@/lib/money";

/**
 * Charging logged hours to the jobs they were worked on.
 *
 * Deliberately a separate, explicit step rather than something that happens as
 * time is entered: it writes to the ledger, and a site clerk logging hours
 * should not be posting vouchers as a side effect. Whoever runs it decides the
 * period and can see what it will do first.
 */
export default function PostLabour({
  companyId,
  from,
  to,
  pending,
}: {
  companyId: string;
  from: string;
  to: string;
  /** Entries with a job that have not been charged yet, for the period shown. */
  pending: { hours: number; amount: number; entries: number };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ reference: string; jobs: number; hours: number; amount: number } | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost"
        title="Charge logged hours to the jobs they were worked on"
      >
        <Clock className="h-4 w-4" />
        Post labour
        {pending.entries > 0 && (
          <span className="ml-1 rounded-full bg-brand-gold/20 px-1.5 text-xs font-medium text-brand-gold">
            {pending.entries}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Charge labour to jobs</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {done ? (
            <>
              <p className="text-sm text-ink">
                Posted <span className="font-mono font-medium">{done.reference}</span> &mdash; {done.hours}h across{" "}
                {done.jobs} job{done.jobs === 1 ? "" : "s"}, {money(done.amount)}.
              </p>
              <p className="text-xs text-muted">
                Those jobs now carry their labour cost, and the same amount is credited back to Labour Recovered so
                the profit for the period is unchanged. Nothing is counted twice.
              </p>
              <div className="flex justify-end">
                <button onClick={() => { setDone(null); setOpen(false); }} className="btn-primary">Close</button>
              </div>
            </>
          ) : (
            <>
              <p className="rounded bg-brand-paper p-3 text-xs text-muted">
                Time logged against a job is only recorded hours until it is charged. This turns those hours into
                cost on the job, at the rate stored on each entry.
              </p>

              <div className="rounded-lg border border-line p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted">Period</span><span className="text-ink">{from} to {to}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted">Entries waiting</span><span className="text-ink">{pending.entries}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted">Hours</span><span className="text-ink">{pending.hours}</span></div>
                <div className="mt-1 flex justify-between border-t border-line pt-1">
                  <span className="text-muted">Cost to charge</span>
                  <span className="font-medium text-heading">{money(pending.amount)}</span>
                </div>
              </div>

              <p className="text-xs text-muted">
                It posts one voucher: the cost onto each job, and the total credited to Labour Recovered. Your
                profit for the period does not change &mdash; the wages were already in the accounts. What changes is
                that each job now shows what its labour cost.
              </p>

              {error && <p className="text-sm text-brand-gold">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
                <button
                  disabled={busy || pending.entries === 0}
                  onClick={async () => {
                    setError("");
                    setBusy(true);
                    const res = await postLabourToJobs(companyId, from, to);
                    setBusy(false);
                    if (res.ok) setDone(res);
                    else setError(res.error);
                  }}
                  className="btn-primary disabled:opacity-50"
                >
                  {busy ? "Posting…" : "Post labour"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
