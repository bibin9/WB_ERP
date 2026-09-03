"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { addStep } from "@/app/(app)/settings/approvals/actions";

type Role = { id: string; name: string; approvalLevel: number };

export default function AddStepRow({ routeId, roles }: { routeId: string; roles: Role[] }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addStep(fd);
        formRef.current?.reset();
      }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-brand-paper px-3 py-2"
    >
      <input type="hidden" name="routeId" value={routeId} />
      <span className="text-xs font-medium text-muted">Add approver:</span>
      <select name="roleId" required defaultValue="" className="input h-8 w-48 py-1 text-sm">
        <option value="" disabled>Select role…</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>{r.name} (L{r.approvalLevel})</option>
        ))}
      </select>
      <span className="text-xs text-muted">only if amount ≥</span>
      <input name="minAmount" type="number" className="input h-8 w-28 py-1 text-sm" placeholder="(any)" />
      <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-navy-900">
        <Plus className="h-3.5 w-3.5" /> Add step
      </button>
    </form>
  );
}
