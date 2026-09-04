"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createLeaveRequest } from "@/app/(app)/hr/leave/actions";

type Emp = { id: string; label: string };
const FALLBACK_TYPES = ["Annual", "Sick", "Unpaid", "Comp-Off"];

export default function LeaveForm({ employees, leaveTypes }: { employees: Emp[]; leaveTypes?: string[] }) {
  const types = leaveTypes && leaveTypes.length ? leaveTypes : FALLBACK_TYPES;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)} disabled={employees.length === 0}><Plus className="h-4 w-4" /> Request leave</button>;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Request Leave</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form action={async (fd) => { setError(""); const r = await createLeaveRequest(fd); if (r?.ok) setOpen(false); else setError(r?.error || "Failed"); }} className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Employee</label>
            <select name="employeeId" className="input" required>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Leave type</label>
            <select name="type" className="input" defaultValue={types[0]}>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">From</label>
              <input type="date" name="fromDate" className="input" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">To</label>
              <input type="date" name="toDate" className="input" required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Reason</label>
            <input name="reason" className="input" placeholder="Optional" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Submit request</button>
          </div>
        </form>
      </div>
    </div>
  );
}
