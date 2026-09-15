"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { finishEstimate } from "@/app/(app)/crm/estimates/actions";

/** Marking an estimate finished and fit to quote from. */
export default function FinishEstimate({ estimateId, blocked }: { estimateId: string; blocked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <span className="inline-flex flex-col items-end">
      <button
        onClick={async () => {
          setError("");
          setBusy(true);
          const res = await finishEstimate(estimateId);
          setBusy(false);
          if (!res.ok) setError(res.error);
        }}
        disabled={busy || blocked}
        title={blocked ? "There is something to put right first" : undefined}
        className="btn-primary disabled:opacity-50"
      >
        <CheckCircle2 className="h-4 w-4" /> {busy ? "Marking..." : "Mark it priced"}
      </button>
      {error && <span className="mt-1 max-w-xs text-right text-xs text-brand-gold">{error}</span>}
    </span>
  );
}
