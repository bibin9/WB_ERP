"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { createRole } from "@/app/(app)/settings/roles/actions";

export default function CreateRoleForm() {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await createRole(fd); ref.current?.reset(); }} className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Role name</label>
        <input name="name" className="input h-9 w-56 py-1.5" placeholder="e.g. Draughtsman" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Sign-off level</label>
        <input name="approvalLevel" type="number" className="input h-9 w-28 py-1.5" defaultValue={0} min={0} max={100} />
      </div>
      <button type="submit" className="btn-primary h-9 py-1.5"><Plus className="h-4 w-4" /> Add role</button>
    </form>
  );
}
