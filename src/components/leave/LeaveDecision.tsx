"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { decideLeaveRequest } from "@/app/(app)/hr/leave/actions";

export default function LeaveDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1.5">
      <button disabled={pending} onClick={() => start(() => decideLeaveRequest(id, "Approved"))} className="inline-flex items-center gap-1 rounded-md bg-brand-green px-2 py-1 text-xs font-medium text-white hover:bg-brand-green-700 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button disabled={pending} onClick={() => start(() => decideLeaveRequest(id, "Rejected"))} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
        <X className="h-3.5 w-3.5" /> Reject
      </button>
    </div>
  );
}
