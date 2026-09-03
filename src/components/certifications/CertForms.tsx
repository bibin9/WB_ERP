"use client";

import { useRef } from "react";
import { addCertification, addAppraisal } from "@/app/(app)/hr/certifications/actions";

type Emp = { id: string; label: string };

export function CertForm({ employees }: { employees: Emp[] }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await addCertification(fd); ref.current?.reset(); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-brand-paper p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Employee / worker</label>
        <select name="employeeId" className="input h-9 w-44 py-1.5 text-sm" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Certificate / clearance</label>
        <input name="name" className="input h-9 w-44 py-1.5 text-sm" placeholder="e.g. 6G Welder" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Category</label>
        <select name="category" className="input h-9 py-1.5 text-sm" defaultValue="Competency">
          <option>Competency</option><option>Safety</option><option>Medical</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Expiry</label>
        <input type="date" name="expiryDate" className="input h-9 py-1.5 text-sm" />
      </div>
      <button type="submit" className="btn-primary h-9 py-1.5">Add</button>
    </form>
  );
}

export function AppraisalForm({ employees }: { employees: Emp[] }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await addAppraisal(fd); ref.current?.reset(); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-brand-paper p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Employee</label>
        <select name="employeeId" className="input h-9 w-40 py-1.5 text-sm" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Period</label>
        <input name="period" className="input h-9 w-24 py-1.5 text-sm" placeholder="2026 H1" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Rating (1–5)</label>
        <select name="rating" className="input h-9 py-1.5 text-sm" defaultValue="3">
          {[1, 2, 3, 4, 5].map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="min-w-0 flex-1">
        <label className="mb-1 block text-xs font-medium text-muted">Feedback</label>
        <input name="feedback" className="input h-9 py-1.5 text-sm" placeholder="Line-manager feedback" />
      </div>
      <button type="submit" className="btn-navy h-9 py-1.5">Save</button>
    </form>
  );
}
