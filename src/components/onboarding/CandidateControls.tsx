"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import clsx from "clsx";
import { addCandidate, setCandidateStage, hireCandidate } from "@/app/(app)/hr/onboarding/actions";

const STAGES = ["Applied", "Interview", "Offer", "Hired", "Rejected"];
const badge: Record<string, string> = {
  Applied: "bg-brand-blue/10 text-brand-blue-600",
  Interview: "bg-brand-gold/15 text-brand-gold",
  Offer: "bg-brand-navy/10 text-brand-navy",
  Hired: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
};

export function AddCandidate({ requisitionId }: { requisitionId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue-600 hover:underline"><UserPlus className="h-3.5 w-3.5" /> Add candidate</button>;
  return (
    <form action={async (fd) => { await addCandidate(fd); setOpen(false); }} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-brand-paper p-2">
      <input type="hidden" name="requisitionId" value={requisitionId} />
      <input name="name" className="input h-8 w-40 py-1 text-sm" placeholder="Candidate name" required />
      <input name="email" className="input h-8 w-44 py-1 text-sm" placeholder="Email" />
      <select name="visaType" className="input h-8 w-32 py-1 text-sm" defaultValue="">
        <option value="">Visa type…</option>
        <option>Employment</option><option>Mission</option><option>Local</option>
      </select>
      <button type="submit" className="rounded-md bg-brand-navy px-2.5 py-1.5 text-xs font-medium text-white">Add</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">Cancel</button>
    </form>
  );
}

export function CandidateStage({ id, stage }: { id: string; stage: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", badge[stage])}>{stage}</span>
      {stage !== "Hired" && stage !== "Rejected" && (
        <>
          <select
            value={stage}
            disabled={pending}
            onChange={(e) => { const v = e.target.value; start(() => setCandidateStage(id, v)); }}
            className="rounded-md border border-line bg-white px-1.5 py-1 text-xs outline-none focus:border-brand-blue"
          >
            {STAGES.filter((s) => s !== "Hired").map((s) => <option key={s}>{s}</option>)}
          </select>
          <button disabled={pending} onClick={() => start(() => hireCandidate(id))} className="rounded-md bg-brand-green px-2 py-1 text-xs font-medium text-white hover:bg-brand-green-700 disabled:opacity-50">
            Hire
          </button>
        </>
      )}
    </div>
  );
}
