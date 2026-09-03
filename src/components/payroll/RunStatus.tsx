"use client";

import { useTransition } from "react";
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

export default function RunStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const step = NEXT[status];
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", badge[status])}>{status}</span>
      {step && (
        <button
          disabled={pending}
          onClick={() => start(() => setRunStatus(id, step.to))}
          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-brand-blue disabled:opacity-50"
        >
          {pending ? "…" : step.label}
        </button>
      )}
    </span>
  );
}
