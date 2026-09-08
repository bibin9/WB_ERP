"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { decideLeaveRequest } from "@/app/(app)/hr/leave/actions";

/**
 * Approve or reject one request.
 *
 * Approving can now be refused — a request raised in March when there were days
 * left can reach the approver in May when there are not — so the reason has to
 * land somewhere the approver will see it rather than disappearing.
 */
export default function LeaveDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const decide = (decision: "Approved" | "Rejected") =>
    start(async () => {
      setError("");
      const res = await decideLeaveRequest(id, decision);
      if (res && !res.ok) setError(res.error ?? "Could not save");
    });

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button
          disabled={pending}
          onClick={() => decide("Approved")}
          className="inline-flex items-center gap-1 rounded-md bg-brand-green px-2 py-1 text-xs font-medium text-white hover:bg-brand-green-700 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" /> Approve
        </button>
        <button
          disabled={pending}
          onClick={() => decide("Rejected")}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Reject
        </button>
      </div>
      {error && <p className="mt-1 max-w-xs whitespace-normal text-xs text-brand-gold">{error}</p>}
    </div>
  );
}
