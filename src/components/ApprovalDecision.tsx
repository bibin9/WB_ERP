"use client";

import { useState, useTransition } from "react";
import { Check, X, Undo2 } from "lucide-react";
import { decideStep, sendBackStep } from "@/app/(app)/approvals/actions";

/**
 * What an approver can do with the step in front of them.
 *
 * Three things, not two. Approve and Reject were the only options, and
 * rejection kills the document — so an approver who wanted a quantity
 * corrected either rejected it, and the whole thing was raised again from
 * scratch, or approved it and told somebody by phone. Sending it back to an
 * earlier stage is what was actually meant, and it asks for the reason
 * because whoever receives it has nothing else to go on.
 */
export default function ApprovalDecision({
  stepId,
  earlier = [],
}: {
  stepId: string;
  /** The stages before this one, in route order. */
  earlier?: { order: number; roleName: string }[];
}) {
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [back, setBack] = useState(false);
  const [toOrder, setToOrder] = useState(earlier.length ? earlier[0].order : 0);

  const decide = (decision: "Approved" | "Rejected") =>
    start(async () => {
      setError("");
      const res = await decideStep(stepId, decision, comment);
      if (!res.ok) setError(res.error);
    });

  if (back) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={toOrder}
          onChange={(e) => setToOrder(Number(e.target.value))}
          className="input h-8 w-44 py-1 text-xs"
          aria-label="Send back to"
        >
          {earlier.map((s) => (
            <option key={s.order} value={s.order}>Back to {s.order}. {s.roleName}</option>
          ))}
        </select>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What needs correcting?"
          className="input h-8 w-56 py-1 text-xs"
        />
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await sendBackStep(stepId, toOrder, comment);
              if (!res.ok) setError(res.error);
              else setBack(false);
            })
          }
          className="inline-flex items-center gap-1 rounded-md bg-brand-gold px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" /> {pending ? "Sending…" : "Send back"}
        </button>
        <button onClick={() => { setBack(false); setError(""); }} className="text-xs text-muted hover:text-ink">
          Cancel
        </button>
        {error && <p className="basis-full text-xs text-brand-gold">{error}</p>}
      </div>
    );
  }

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
      {earlier.length > 0 && (
        <button
          disabled={pending}
          onClick={() => setBack(true)}
          title="Return it to an earlier stage to be corrected, rather than rejecting it outright"
          className="inline-flex items-center gap-1 rounded-md border border-brand-gold/40 px-2.5 py-1.5 text-xs font-medium text-brand-gold hover:bg-brand-gold/10 disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" /> Send back
        </button>
      )}
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
