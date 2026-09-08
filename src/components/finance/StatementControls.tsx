"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, Undo2 } from "lucide-react";
import { clearUpTo, unclearStatement } from "@/app/(app)/finance/bank-rec/actions";

/**
 * The statement being worked to: its date, its closing balance, and its name.
 *
 * These live on the URL rather than in a form, so a half-finished
 * reconciliation survives a refresh and can be picked up tomorrow — which is
 * how they are actually done, over a couple of sittings.
 */
export default function StatementControls({
  companyId,
  accountId,
  statementDate,
  statementBalance,
  statementRef,
  unclearedCount,
}: {
  companyId: string;
  accountId: string;
  statementDate: string;
  statementBalance: string;
  statementRef: string;
  unclearedCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const set = (next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  return (
    <div className="card p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Statement date</label>
          <input
            type="date"
            defaultValue={statementDate}
            onChange={(e) => set({ d: e.target.value })}
            className="input h-9 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Closing balance on the statement</label>
          <input
            type="number"
            step="0.01"
            defaultValue={statementBalance}
            placeholder="as printed"
            onBlur={(e) => set({ b: e.target.value })}
            className="input h-9 w-44 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Statement reference</label>
          <input
            defaultValue={statementRef}
            placeholder="e.g. Aug-2026"
            onBlur={(e) => set({ s: e.target.value })}
            className="input h-9 w-36 py-1.5 text-sm"
          />
        </div>

        <button
          type="button"
          disabled={busy || !statementDate || unclearedCount === 0}
          onClick={async () => {
            setBusy(true);
            setMsg("");
            const res = await clearUpTo(companyId, accountId, statementDate, statementRef);
            setBusy(false);
            setMsg(res.ok ? `Ticked ${res.count} line${res.count === 1 ? "" : "s"}. Untick anything the bank has not shown.` : res.error ?? "");
            if (res.ok) router.refresh();
          }}
          className="btn-ghost h-9 py-1.5 text-sm disabled:opacity-40"
          title="Tick everything dated on or before the statement date"
        >
          <CheckCheck className="h-4 w-4" /> Tick everything up to that date
        </button>

        {statementRef && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg("");
              const res = await unclearStatement(companyId, accountId, statementRef);
              setBusy(false);
              setMsg(res.ok ? `Undone ${res.count} line${res.count === 1 ? "" : "s"}.` : res.error ?? "");
              if (res.ok) router.refresh();
            }}
            className="rounded px-2 py-1 text-xs text-muted hover:bg-line hover:text-ink"
            title={`Undo every tick made against ${statementRef}`}
          >
            <Undo2 className="mr-1 inline h-3 w-3" /> Undo {statementRef}
          </button>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      <p className="mt-2 text-xs text-muted">
        Ticking a line only records that the bank has shown it. Nothing is posted &mdash; the money moved when the
        voucher did.
      </p>
    </div>
  );
}
