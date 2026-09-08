"use client";

import { useRef, useState } from "react";
import { markAttendance, addTimesheet } from "@/app/(app)/hr/attendance/actions";

/** hourlyCost lets the form show what an entry will cost the job before it is saved. */
type Emp = { id: string; label: string; hourlyCost?: number };
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
      <div>
        <label
          className="mb-1 block text-xs font-medium text-muted"
          title="Overtime past the eighth hour, paid at 125% of basic."
        >
          OT hrs
        </label>
        <input name="otHours" type="number" step="0.5" min="0" className="input h-9 w-20 py-1.5 text-sm" placeholder="0" />
      </div>
      <div>
        <label
          className="mb-1 block text-xs font-medium text-muted"
          title="Overtime at 150%: hours between 22:00 and 04:00, a rest day, or a public holiday taken as pay rather than a day off."
        >
          OT @150%
        </label>
        <input name="otPremiumHours" type="number" step="0.5" min="0" className="input h-9 w-20 py-1.5 text-sm" placeholder="0" />
      </div>
      <button type="submit" className="btn-primary h-9 py-1.5">Mark</button>
    </form>
  );
}

export function TimesheetForm({
  employees,
  jobs = [],
}: {
  employees: Emp[];
  /** Open jobs this time can be charged to, with each person's hourly cost. */
  jobs?: { id: string; code: string; name: string }[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [hours, setHours] = useState("8");

  const chosen = employees.find((e) => e.id === employeeId);
  const rate = chosen?.hourlyCost ?? 0;
  const cost = rate * (Number(hours) || 0);

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setError("");
        const res = await addTimesheet(fd);
        if (res?.ok) ref.current?.reset();
        else setError(res?.error || "Could not log this time");
      }}
      className="rounded-lg border border-line bg-brand-paper p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Employee</label>
          <select
            name="employeeId"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="input h-9 w-44 py-1.5 text-sm"
            required
          >
            {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Date</label>
          <input type="date" name="date" className="input h-9 py-1.5 text-sm" defaultValue={today()} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Job</label>
          <select
            name="jobId"
            className="input h-9 w-52 py-1.5 text-sm"
            title="The job this time was spent on. Until a job is chosen, these hours cost the job nothing and its margin looks better than it is."
            required
          >
            <option value="">— choose a job —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Hours</label>
          <input
            name="hours"
            type="number"
            step="0.5"
            min="0.5"
            max="24"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="input h-9 w-20 py-1.5 text-sm"
            required
          />
        </div>
        <button type="submit" className="btn-navy h-9 py-1.5">Log time</button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {rate > 0 ? (
          <>
            Charged to the job at <span className="font-medium text-ink">{rate.toFixed(2)}/h</span>
            {Number(hours) > 0 && <> &mdash; this entry costs the job <span className="font-medium text-ink">{cost.toFixed(2)}</span></>}.
            Hours only reach the job once someone posts them from the Job Costing screen.
          </>
        ) : (
          <>
            This person has no pay on record, so these hours would cost the job nothing. Add their salary, or an
            hourly cost, on their profile first.
          </>
        )}
      </p>
      {error && <p className="mt-2 text-sm text-brand-gold">{error}</p>}
    </form>
  );
}
