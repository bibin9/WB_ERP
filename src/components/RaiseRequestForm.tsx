"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createApprovalRequest } from "@/app/(app)/approvals/actions";

type Opt = { id: string; label: string };

export default function RaiseRequestForm({ companies, docTypes }: { companies: Opt[]; docTypes: string[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Raise for approval
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Raise for Approval</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          action={async (fd) => {
            await createApprovalRequest(fd);
            setOpen(false);
          }}
          className="space-y-4 p-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Company</label>
              <select name="companyId" className="input" required>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Document type</label>
              <select name="docType" className="input" required>
                {docTypes.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Title / reference</label>
            <input name="title" className="input" placeholder="e.g. PO for steel plates" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Amount (AED, optional)</label>
            <input name="amount" type="number" className="input" placeholder="e.g. 75000" />
            <p className="mt-1 text-xs text-muted">Amounts over 50,000 add the Managing Director to the route.</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Submit</button>
          </div>
        </form>
      </div>
    </div>
  );
}
