"use client";

import { useTransition } from "react";
import clsx from "clsx";
import { setEmployeeStatus } from "@/app/(app)/hr/employee-actions";

const colors: Record<string, string> = {
  Active: "text-brand-green-700",
  "On Leave": "text-brand-gold",
  Inactive: "text-muted",
};

export default function EmployeeStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => { const v = e.target.value; start(() => setEmployeeStatus(id, v)); }}
      className={clsx("rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium outline-none focus:border-brand-blue", colors[status])}
    >
      <option>Active</option>
      <option>On Leave</option>
      <option>Inactive</option>
    </select>
  );
}
