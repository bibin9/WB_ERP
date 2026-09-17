"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { decideStep } from "@/app/(app)/approvals/actions";

export default function ApprovalDecision({ stepId }: { stepId: string }) {
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const decide = (decision: "Approved" | "Rejected") =>
    start(async () => {
      setError("");
      const res = await decideStep(stepId, decision, comment);
      if (!res.ok) setError(res.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        className="input h-8 w-40 py-1 text-xs"
      />
      <button
        disabled={pending}
        onClick={() => decide("Approved")}
        className="inline-flex items-center gap-1 rounded-md bg-brand-green px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-green-700 disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button
        disabled={pending}
        onClick={() => decide("Rejected")}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" /> Reject
      </button>
      {error && <p className="basis-full text-xs text-brand-gold">{error}</p>}
    </div>
  );
}
