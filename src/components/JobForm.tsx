"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createJob, updateJob } from "@/app/(app)/hr/actions";

type Company = { id: string; code: string; name: string };
export type EditingJob = {
  id: string; title: string; description: string | null; priority: string;
  assignedTo: string; assignedToType: string; timeAllocation: string | null; dueDate: string | null;
};

export default function JobForm({ companies, departments, people, job }: { companies: Company[]; departments: string[]; people: string[]; job?: EditingJob }) {
  const [open, setOpen] = useState(false);
  const editing = !!job;
  const due = job?.dueDate ? job.dueDate.slice(0, 10) : "";
  const [type, setType] = useState(job?.assignedToType ?? "person");
  const [assignee, setAssignee] = useState(job?.assignedTo ?? "");
  const options = type === "department" ? departments : people;
  const withCurrent = assignee && !options.includes(assignee) ? [assignee, ...options] : options;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-4 w-4" />
    </button>
  ) : (
    <button className="btn-primary" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" /> New assignment
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-brand-navy">{editing ? "Edit Assignment" : "New Job Assignment"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => { editing ? await updateJob(fd) : await createJob(fd); setOpen(false); }}
          className="space-y-4 p-5"
        >
          {editing && <input type="hidden" name="id" value={job!.id} />}
          <div className="grid grid-cols-2 gap-3">
            {!editing && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Company</label>
                <select name="companyId" className="input" required>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className={editing ? "col-span-2" : ""}>
              <label className="mb-1 block text-sm font-medium text-ink">Priority</label>
              <select name="priority" className="input" defaultValue={job?.priority ?? "Normal"}>
                <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Title</label>
            <input name="title" className="input" defaultValue={job?.title ?? ""} placeholder="What needs to be done?" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description</label>
            <textarea name="description" className="input" rows={2} defaultValue={job?.description ?? ""} placeholder="Details (optional)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Type</label>
              <select name="assignedToType" value={type} onChange={(e) => { setType(e.target.value); setAssignee(""); }} className="input">
                <option value="person">Person</option>
                <option value="department">Department</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Assign to ({type === "department" ? "department" : "employee"})</label>
              <select name="assignedTo" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input" required>
                <option value="">Select…</option>
                {withCurrent.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Due date</label>
              <input type="date" name="dueDate" className="input" defaultValue={due} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Time allocation</label>
              <input name="timeAllocation" className="input" defaultValue={job?.timeAllocation ?? ""} placeholder="e.g. 2d, 4h" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save changes" : "Create assignment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
