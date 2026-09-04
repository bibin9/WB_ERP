"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createEmployee, updateEmployee } from "@/app/(app)/hr/employee-actions";

type Company = { id: string; code: string; name: string };
export type EditingEmployee = {
  id: string; name: string; email: string | null; phone: string | null;
  department: string | null; designation: string | null; grade: string | null;
  employmentType: string; supplier?: string | null; basicSalary: number; allowances: number;
};

type Master = { Department?: string[]; Designation?: string[]; Grade?: string[] };

export default function EmployeeForm({ companies, employee, master = {} }: { companies: Company[]; employee?: EditingEmployee; master?: Master }) {
  const [open, setOpen] = useState(false);
  const editing = !!employee;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-4 w-4" />
    </button>
  ) : (
    <button className="btn-primary" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" /> Add employee
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-10">
      <div className="card w-full max-w-xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? "Edit Employee" : "Add Employee"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => { editing ? await updateEmployee(fd) : await createEmployee(fd); setOpen(false); }}
          className="grid grid-cols-2 gap-3 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={employee!.id} />
          ) : (
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Company</label>
              <select name="companyId" className="input" required>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
          )}
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Full name</label>
            <input name="name" className="input" defaultValue={employee?.name ?? ""} placeholder="Employee name" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input name="email" type="email" className="input" defaultValue={employee?.email ?? ""} placeholder="name@company.com" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
            <input name="phone" className="input" defaultValue={employee?.phone ?? ""} placeholder="+971…" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Department</label>
            <input name="department" list="md-dept" className="input" defaultValue={employee?.department ?? ""} placeholder="Select or type" />
            <datalist id="md-dept">{(master.Department ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Designation</label>
            <input name="designation" list="md-desig" className="input" defaultValue={employee?.designation ?? ""} placeholder="Select or type" />
            <datalist id="md-desig">{(master.Designation ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Grade</label>
            <input name="grade" list="md-grade" className="input" defaultValue={employee?.grade ?? ""} placeholder="Select or type" />
            <datalist id="md-grade">{(master.Grade ?? []).map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Employment type</label>
            <select name="employmentType" className="input" defaultValue={employee?.employmentType ?? "Full-time"}>
              <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Supplied</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Manpower supplier / sponsor <span className="font-normal text-muted">(for supplied workers)</span></label>
            <input name="supplier" className="input" defaultValue={employee?.supplier ?? ""} placeholder="e.g. Gulf Manpower LLC" />
          </div>
          <div className="col-span-2 mt-1 rounded-lg bg-brand-blue/5 p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-muted">Payroll master data (structure only)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Basic salary (AED)</label>
                <input name="basicSalary" type="number" className="input" defaultValue={employee?.basicSalary ?? ""} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Allowances (AED)</label>
                <input name="allowances" type="number" className="input" defaultValue={employee?.allowances ?? ""} placeholder="0" />
              </div>
            </div>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save changes" : "Add employee"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
