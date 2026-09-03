"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, Loader2, Users } from "lucide-react";
import { saveMuster } from "@/app/(app)/hr/attendance/actions";

type Emp = { id: string; empNo: string; name: string; department: string | null };

const STATUSES = [
  { key: "Present", short: "P", active: "bg-brand-green text-white", idle: "text-brand-green-700 hover:bg-brand-green/10" },
  { key: "Absent", short: "A", active: "bg-red-500 text-white", idle: "text-red-600 hover:bg-red-50" },
  { key: "Leave", short: "L", active: "bg-brand-gold text-white", idle: "text-brand-gold hover:bg-brand-gold/10" },
  { key: "Half-day", short: "½", active: "bg-brand-blue-600 text-white", idle: "text-brand-blue-600 hover:bg-brand-blue/10" },
  { key: "Off", short: "Off", active: "bg-muted text-white", idle: "text-muted hover:bg-line" },
];

export default function MusterBoard({
  employees, companyId, date, initial,
}: {
  employees: Emp[];
  companyId: string;
  date: string; // yyyy-mm-dd
  initial: Record<string, string>; // employeeId -> status already saved for this date
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  // Default everyone to Present unless already marked for this date
  const [status, setStatus] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const e of employees) s[e.id] = initial[e.id] ?? "Present";
    return s;
  });

  const departments = useMemo(
    () => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))) as string[],
    [employees]
  );
  const [dept, setDept] = useState<string>("All");
  const shown = dept === "All" ? employees : employees.filter((e) => e.department === dept);

  const counts = useMemo(() => {
    const c = { Present: 0, Absent: 0, Leave: 0, "Half-day": 0, Off: 0 } as Record<string, number>;
    for (const e of employees) c[status[e.id]] = (c[status[e.id]] ?? 0) + 1;
    return c;
  }, [status, employees]);

  const setAllPresent = () => setStatus((prev) => {
    const next = { ...prev };
    for (const e of shown) next[e.id] = "Present";
    return next;
  });

  const changeDate = (d: string) => router.push(`/hr/attendance?c=${companyId}&d=${d}`);

  const save = () => {
    setSaved(false);
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("date", date);
    fd.set("marks", JSON.stringify(employees.map((e) => ({ employeeId: e.id, status: status[e.id] }))));
    start(async () => { await saveMuster(fd); setSaved(true); });
  };

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-paper px-4 py-3">
        <div className="flex items-center gap-2 text-brand-navy">
          <Users className="h-5 w-5" />
          <span className="font-semibold">Daily Muster</span>
          <span className="text-sm text-muted">— tap only the exceptions, everyone else stays Present</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted">Date</label>
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="input h-9 w-auto py-1" />
        </div>
      </div>

      {/* Filters + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {["All", ...departments].map((d) => (
            <button key={d} onClick={() => setDept(d)}
              className={clsx("rounded-full px-3 py-1 text-xs font-medium",
                dept === d ? "bg-brand-navy text-white" : "bg-line text-muted hover:text-ink")}>
              {d}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-brand-green-700">Present {counts.Present}</span>
          <span className="text-red-600">Absent {counts.Absent}</span>
          <span className="text-brand-gold">Leave {counts.Leave}</span>
          <button onClick={setAllPresent} className="rounded-md border border-line px-2.5 py-1 font-medium text-brand-navy hover:bg-brand-paper">
            Mark all present
          </button>
        </div>
      </div>

      {/* Roster */}
      <ul className="divide-y divide-line">
        {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No employees in this filter.</li>}
        {shown.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <span className="font-medium text-ink">{e.name}</span>
              <span className="ml-2 font-mono text-xs text-muted">{e.empNo}</span>
              {e.department && <span className="ml-2 text-xs text-muted">· {e.department}</span>}
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
              {STATUSES.map((s) => {
                const on = status[e.id] === s.key;
                return (
                  <button key={s.key} onClick={() => setStatus((p) => ({ ...p, [e.id]: s.key }))}
                    title={s.key}
                    className={clsx("min-w-[34px] border-l border-line px-2 py-1 text-sm font-semibold first:border-l-0 transition-colors",
                      on ? s.active : s.idle)}>
                    {s.short}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 border-t border-line bg-brand-paper px-4 py-3">
        <span className="text-xs text-muted">
          {employees.length} employees · saving marks attendance for <span className="font-medium text-ink">{new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>
        </span>
        <div className="flex items-center gap-3">
          {saved && !pending && <span className="flex items-center gap-1 text-sm text-brand-green-700"><Check className="h-4 w-4" /> Saved</span>}
          <button onClick={save} disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save muster
          </button>
        </div>
      </div>
    </div>
  );
}
