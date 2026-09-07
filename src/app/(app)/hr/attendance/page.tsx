import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import GuardedDelete from "@/components/GuardedDelete";
import { TimesheetForm } from "@/components/attendance/AttendanceForms";
import MusterBoard from "@/components/attendance/MusterBoard";
import PunchImport from "@/components/attendance/PunchImport";
import { deleteAttendance, deleteTimesheet } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import ExportButton from "@/components/ExportButton";
import Link from "next/link";
import { hourlyCostFor } from "@/lib/labour";
import { money, toFils } from "@/lib/money";

export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const attBadge: Record<string, string> = {
  Present: "bg-brand-green/10 text-brand-green-700",
  Absent: "bg-red-50 text-red-600",
  Leave: "bg-brand-gold/15 text-brand-gold",
  Off: "bg-line text-muted",
  "Half-day": "bg-brand-blue/10 text-brand-blue-600",
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ c?: string; d?: string }> }) {
  await requireAccess("hr.attendance");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const employees = companyId ? await db.employee.findMany({ where: { companyId, status: { not: "Inactive" } }, orderBy: { name: "asc" } }) : [];
  // The hourly cost travels with the option so the form can show what an entry
  // will cost the job before it is saved.
  const empOpts = employees.map((e) => ({
    id: e.id,
    label: `${e.empNo} — ${e.name}`,
    hourlyCost: toFils(hourlyCostFor(e)),
  }));

  // Only jobs that are still running can take new time.
  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId, isActive: true, status: { in: ["Open", "On hold"] } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  // Muster: selected day + already-saved marks for that day
  const musterDate = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : new Date().toISOString().slice(0, 10);
  const dayMarks = companyId
    ? await db.attendance.findMany({ where: { companyId, date: new Date(musterDate) }, select: { employeeId: true, status: true } })
    : [];
  const initial: Record<string, string> = Object.fromEntries(dayMarks.map((m) => [m.employeeId, m.status]));

  const attendance = companyId
    ? await db.attendance.findMany({ where: { companyId }, include: { employee: true }, orderBy: { date: "desc" }, take: 20 })
    : [];
  const timesheets = companyId
    ? await db.timesheet.findMany({
        where: { companyId },
        include: { employee: true, job: { select: { code: true, name: true } }, entry: { select: { reference: true } } },
        orderBy: { date: "desc" },
        take: 20,
      })
    : [];
  const totalHours = timesheets.reduce((s, t) => s + t.hours, 0);

  // Time that will never reach a job unless somebody goes back and fixes it.
  const unassigned = companyId
    ? await db.timesheet.count({ where: { companyId, jobId: null } })
    : 0;
  const pending = companyId
    ? await db.timesheet.count({ where: { companyId, jobId: { not: null }, entryId: null } })
    : 0;

  return (
    <div>
      <PageHeader title="HR & Admin — Attendance & Timesheets" subtitle="Mark daily attendance and log time against a job — this is what puts labour into job costing.">
        {companyId && <ExportButton dataset="attendance" companyId={companyId} />}
      </PageHeader>
      <HrTabs />
      <div className="mb-5"><CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} /></div>

      {/* Muster (exception-based bulk entry) */}
      <div className="mb-6">
        <MusterBoard
          employees={employees.map((e) => ({ id: e.id, empNo: e.empNo, name: e.name, department: e.department }))}
          companyId={companyId}
          date={musterDate}
          initial={initial}
        />
      </div>

      {/* Punch machine import */}
      <div className="mb-6">
        <PunchImport companyId={companyId} />
      </div>

      {/* Recent attendance */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Recent attendance</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Date</th><th className="px-4 py-2 font-semibold">Employee</th>
              <th className="px-4 py-2 font-semibold">Status</th><th className="px-4 py-2 text-center font-semibold">Hours</th>
              <th className="px-4 py-2 font-semibold">Remarks</th><th className="px-4 py-2 text-right font-semibold"></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {attendance.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No attendance marked yet.</td></tr>}
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(a.date)}</td>
                  <td className="px-4 py-2 text-ink">{a.employee.name}</td>
                  <td className="px-4 py-2"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", attBadge[a.status])}>{a.status}</span></td>
                  <td className="px-4 py-2 text-center tabular-nums">{a.hours}</td>
                  <td className="px-4 py-2 text-muted">{a.remarks ?? "—"}</td>
                  <td className="px-4 py-2 text-right"><GuardedDelete screen="hr.attendance" action={deleteAttendance.bind(null, a.id)} label="Delete this attendance record?" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timesheets */}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Job timesheets{totalHours > 0 && ` · ${totalHours}h logged`}</h2>

        {(unassigned > 0 || pending > 0) && (
          <div className="mb-3 rounded-lg border border-line bg-brand-paper px-4 py-3 text-sm text-ink">
            {pending > 0 && (
              <div>
                <span className="font-semibold">{pending}</span> time {pending === 1 ? "entry is" : "entries are"} waiting to be
                charged to their jobs.{" "}
                <Link href={`/finance/jobs?c=${companyId}`} className="text-brand-blue-600 underline">
                  Post them from Job Costing
                </Link>
                .
              </div>
            )}
            {unassigned > 0 && (
              <div className={pending > 0 ? "mt-1 text-muted" : "text-muted"}>
                <span className="font-semibold text-brand-gold">{unassigned}</span>{" "}
                {unassigned === 1 ? "entry has" : "entries have"} no job on them, so that work costs nothing on any job
                and every margin reads better than it is.
              </div>
            )}
          </div>
        )}

        <div className="mb-3"><TimesheetForm employees={empOpts} jobs={jobs} /></div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
              <th className="px-4 py-2 font-semibold">Date</th><th className="px-4 py-2 font-semibold">Employee</th>
              <th className="px-4 py-2 font-semibold">Job</th><th className="px-4 py-2 text-center font-semibold">Hours</th>
              <th className="px-4 py-2 text-right font-semibold">Rate</th><th className="px-4 py-2 text-right font-semibold">Cost</th>
              <th className="px-4 py-2 font-semibold">Charged</th><th className="px-4 py-2 text-right font-semibold"></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {timesheets.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No time logged yet.</td></tr>}
              {timesheets.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(t.date)}</td>
                  <td className="px-4 py-2 text-ink">{t.employee.name}</td>
                  <td className="px-4 py-2">
                    {t.job ? (
                      <span className="rounded bg-brand-navy/5 px-2 py-0.5 font-mono text-xs text-heading">{t.job.code}</span>
                    ) : (
                      <span className="text-xs text-brand-gold" title="This time will never reach job costing until a job is set">
                        no job
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums">{t.hours}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{t.costRate > 0 ? money(t.costRate) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.costRate > 0 ? money(t.hours * t.costRate) : "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {t.entry ? (
                      <span className="font-mono text-brand-green-700">{t.entry.reference}</span>
                    ) : (
                      <span className="text-muted">not yet</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right"><GuardedDelete screen="hr.attendance" action={deleteTimesheet.bind(null, t.id)} label="Delete this time entry?" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
