"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { setRunStatus } from "@/app/(app)/hr/payroll/actions";

const NEXT: Record<string, { to: string; label: string } | undefined> = {
  Draft: { to: "Approved", label: "Approve" },
  Approved: { to: "Paid", label: "Mark paid" },
  Paid: undefined,
};
const badge: Record<string, string> = {
  Draft: "bg-brand-gold/15 text-brand-gold",
  Approved: "bg-brand-blue/10 text-brand-blue-600",
  Paid: "bg-brand-green/10 text-brand-green-700",
};

/**
 * Move a run along, and say so when it will not move.
 *
 * Marking a run Paid now writes it to the ledger, which can be refused — a
 * missing account, a closed period. That refusal has to reach the person who
 * clicked; a status that silently does not change is worse than an error.
 */
export default function RunStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const step = NEXT[status];

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2">
        <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", badge[status])}>{status}</span>
        {step && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError("");
                const res = await setRunStatus(id, step.to);
                if (res && !res.ok) setError(res.error ?? "Could not change the status");
              })
            }
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-brand-blue disabled:opacity-50"
          >
            {pending ? "…" : step.label}
          </button>
        )}
      </span>
      {error && <span className="max-w-xs whitespace-normal text-right text-xs text-brand-gold">{error}</span>}
    </span>
  );
}
