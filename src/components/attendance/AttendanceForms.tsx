"use client";

import { useRef } from "react";
import { markAttendance, addTimesheet } from "@/app/(app)/hr/attendance/actions";

type Emp = { id: string; label: string };
const today = () => new Date().toISOString().slice(0, 10);

export function MarkAttendanceForm({ employees }: { employees: Emp[] }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await markAttendance(fd); ref.current?.reset(); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-brand-paper p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Employee</label>
        <select name="employeeId" className="input h-9 w-48 py-1.5 text-sm" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Date</label>
        <input type="date" name="date" className="input h-9 py-1.5 text-sm" defaultValue={today()} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Status</label>
        <select name="status" className="input h-9 py-1.5 text-sm" defaultValue="Present">
          <option>Present</option><option>Absent</option><option>Leave</option><option>Off</option><option>Half-day</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Hours</label>
        <input name="hours" type="number" className="input h-9 w-20 py-1.5 text-sm" placeholder="8" />
      </div>
      <button type="submit" className="btn-primary h-9 py-1.5">Mark</button>
    </form>
  );
}

export function TimesheetForm({ employees }: { employees: Emp[] }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await addTimesheet(fd); ref.current?.reset(); }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-brand-paper p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Employee</label>
        <select name="employeeId" className="input h-9 w-44 py-1.5 text-sm" required>{employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Date</label>
        <input type="date" name="date" className="input h-9 py-1.5 text-sm" defaultValue={today()} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Project ID / ref</label>
        <input name="projectRef" className="input h-9 w-40 py-1.5 text-sm" placeholder="e.g. PRJ-001" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Hours</label>
        <input name="hours" type="number" step="0.5" className="input h-9 w-20 py-1.5 text-sm" placeholder="8" required />
      </div>
      <button type="submit" className="btn-navy h-9 py-1.5">Log time</button>
    </form>
  );
}
