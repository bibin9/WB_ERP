"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { decideStep } from "@/app/(app)/approvals/actions";

export default function ApprovalDecision({ stepId }: { stepId: string }) {
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        className="input h-8 w-40 py-1 text-xs"
      />
      <button
        disabled={pending}
        onClick={() => start(() => decideStep(stepId, "Approved", comment))}
        className="inline-flex items-center gap-1 rounded-md bg-brand-green px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-green-700 disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button
        disabled={pending}
        onClick={() => start(() => decideStep(stepId, "Rejected", comment))}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" /> Reject
      </button>
    </div>
  );
}
