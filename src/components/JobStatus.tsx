"use client";

import { useTransition } from "react";
import clsx from "clsx";
import { updateStatus } from "@/app/(app)/hr/actions";

const FLOW: Record<string, { next?: string; label?: string }> = {
  Open: { next: "In Progress", label: "Start" },
  "In Progress": { next: "Completed", label: "Complete" },
  Completed: { next: "Closed", label: "Close" },
  Closed: {},
};

const badge: Record<string, string> = {
  Open: "bg-brand-blue/10 text-brand-blue-600",
  "In Progress": "bg-brand-gold/15 text-brand-gold",
  Completed: "bg-brand-green/10 text-brand-green-700",
  Closed: "bg-line text-muted",
};

export default function JobStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const step = FLOW[status] ?? {};

  return (
    <div className="flex items-center gap-2">
      <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", badge[status] ?? badge.Open)}>
        {status}
      </span>
      {step.next && (
        <button
          disabled={pending}
          onClick={() => start(() => updateStatus(id, step.next!))}
          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-brand-blue disabled:opacity-50"
        >
          {pending ? "…" : step.label}
        </button>
      )}
    </div>
  );
}
