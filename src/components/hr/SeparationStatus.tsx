"use client";

import { useTransition } from "react";
import clsx from "clsx";
import { setSeparationStatus } from "@/app/(app)/hr/separation/actions";

const STATUSES = ["Draft", "Approved", "Settled"];
const color: Record<string, string> = {
  Draft: "bg-line text-muted",
  Approved: "bg-brand-blue/10 text-brand-blue-600",
  Settled: "bg-brand-green/10 text-brand-green-700",
};

export default function SeparationStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => start(() => setSeparationStatus(id, e.target.value))}
      className={clsx("rounded-full border-0 px-2 py-0.5 text-xs font-medium outline-none", color[status] ?? "bg-line text-muted")}
    >
      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
