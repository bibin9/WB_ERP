import clsx from "clsx";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ExportButton from "@/components/ExportButton";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { resolvePeriod } from "@/lib/period";
import { withDefaults, STATUTORY_POLICY } from "@/lib/hrpolicy";
import {
  summariseOvertime, dailyBreaches, rollingBreaches, overtimeVerdict,
  type PayslipOt, type AttendanceDay,
} from "@/lib/overtime";

export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAccess("hr.overtime");
  const session = await getSession();
  const sp = await searchParams;
  const companyIds = (session?.companies ?? []).map((c) => c.id);
  const period = resolvePeriod(sp, 1);

  // Payslips say what it cost. Attendance says whether it was legal. The two
  // have to be read together, because a company can pay overtime correctly and
  // still be in breach of the hours.
  const slips = companyIds.length
    ? await db.payslip.findMany({
        where: {
          run: {
            companyId: { in: companyIds },
            status: { in: ["Approved", "Paid"] },
          },
        },
        select: {
          employeeId: true, empNo: true, employeeName: true, basic: true,
          otHours: true, otPremiumHours: true, overtime: true,
          run: { select: { period: true, companyId: true } },
        },
      })
    : [];

  // A payslip snapshots the name but not the department, deliberately — the
  // payslip must still read correctly after somebody transfers. The department
  // is therefore today's, which is what a manager grouping the report wants.
  const staff = companyIds.length
    ? await db.employee.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true, department: true },
      })
    : [];
  const departmentOf = new Map(staff.map((e) => [e.id, e.department]));

  const from = period.from.toISOString().slice(0, 7);
  const to = period.to.toISOString().slice(0, 7);
  const rows: PayslipOt[] = slips
    .filter((s) => s.run.period >= from && s.run.period <= to)
    .map((s) => ({
      employeeId: s.employeeId, empNo: s.empNo, employeeName: s.employeeName,
      department: departmentOf.get(s.employeeId) ?? null,
      period: s.run.period, basic: s.basic,
      otHours: s.otHours, otPremiumHours: s.otPremiumHours, overtime: s.overtime,
    }));

  const attendance = companyIds.length
    ? await db.attendance.findMany({
        where: { companyId: { in: companyIds }, date: { gte: period.from, lte: period.to } },
        select: {
          employeeId: true, date: true, hours: true, otHours: true, otPremiumHours: true,
          employee: { select: { empNo: true, name: true } },
        },
        orderBy: { date: "asc" },
      })
    : [];

  const days: AttendanceDay[] = attendance.map((a) => ({
    employeeId: a.employeeId,
    empNo: a.employee?.empNo ?? "—",
    employeeName: a.employee?.name ?? "—",
    date: a.date, hours: a.hours, otHours: a.otHours, otPremiumHours: a.otPremiumHours,
  }));

  // Read here rather than through hr/policy/actions.ts: that helper is gated on
  // the HR Policy screen, so somebody allowed to see overtime but not the
  // handbook would silently be measured against the statutory ceiling instead
  // of their company's stricter one. This page has already checked its own
  // permission and the company scope.
  const stored = companyIds.length
    ? await db.hrPolicy.findUnique({ where: { companyId: companyIds[0] } })
    : null;
  const policy = stored ? withDefaults(stored) : { ...STATUTORY_POLICY };
  const caps = {
    maxOvertimeHoursPerDay: policy.maxOvertimeHoursPerDay,
    maxHoursPerThreeWeeks: policy.maxHoursPerThreeWeeks,
    normalHoursPerDay: policy.normalHoursPerDay,
  };

  const summary = summariseOvertime(rows);
  const daily = dailyBreaches(days, caps);
  const rolling = rollingBreaches(days, caps);
  const v = overtimeVerdict(summary, daily, rolling);

  const tone = {
    good: "border-brand-green/40 bg-brand-green/10 text-brand-green-700",
    watch: "border-brand-gold/40 bg-brand-gold/10 text-ink",
    bad: "border-red-300 bg-red-50 text-red-700",
  }[v.tone];

  return (
    <div>
      <div className="print-header mb-4 hidden border-b border-line pb-3 print:block">
        <div className="text-lg font-bold text-heading">Overtime</div>
        <div className="text-xs text-muted">{period.label}</div>
      </div>

      <PageHeader title="HR — Overtime" subtitle="What overtime cost, who is working it, and where it went over the legal cap.">
        <ExportButton dataset="payroll" companyId={companyIds[0] ?? ""} label="Export payroll" />
      </PageHeader>

      <HrTabs />

      <div className="mb-5">
        <PeriodPicker from={period.fromStr} to={period.toStr} label={period.label} />
      </div>

      <div className={clsx("mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", tone)}>
        {v.tone === "good" ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
        <p className="font-medium">{v.text}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Overtime cost" value={n(summary.totals.cost)} />
        <Tile label="Overtime hours" value={h(summary.totals.totalHours)} sub={`${h(summary.totals.otPremiumHours)} at the night rate`} />
        <Tile label="Share of basic pay" value={summary.totals.basic > 0 ? `${Math.round((summary.totals.cost / summary.totals.basic) * 100)}%` : "—"} />
        <Tile
          label="Over the legal cap"
          value={String(new Set([...daily.map((d) => d.employeeId), ...rolling.map((r) => r.employeeId)]).size)}
          sub="people"
          accent={daily.length + rolling.length > 0 ? "red" : undefined}
        />
      </div>

      {(daily.length > 0 || rolling.length > 0) && (
        <div className="card mb-5 overflow-hidden border-red-200">
          <div className="border-b border-line bg-red-50 px-5 py-3">
            <h2 className="font-semibold text-red-700">Over the legal cap</h2>
            <p className="mt-0.5 text-xs text-red-600">
              Article 19 allows {caps.maxOvertimeHoursPerDay} hours of overtime a day and{" "}
              {caps.maxHoursPerThreeWeeks} hours of work in any three weeks. Both count hours worked, whatever
              rate they were paid at.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Employee</th>
                  <th className="px-4 py-2.5 font-semibold">What</th>
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Hours</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Limit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {daily.slice(0, 50).map((b) => (
                  <tr key={`d-${b.employeeId}-${b.date.toISOString()}`}>
                    <td className="whitespace-nowrap px-4 py-2.5"><span className="text-xs text-muted">{b.empNo}</span> <span className="text-ink">{b.employeeName}</span></td>
                    <td className="px-4 py-2.5 text-xs text-heading">Overtime in one day</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{fmt(b.date)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-600">{h(b.otHours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{h(b.limit)}</td>
                  </tr>
                ))}
                {rolling.map((b) => (
                  <tr key={`r-${b.employeeId}`}>
                    <td className="whitespace-nowrap px-4 py-2.5"><span className="text-xs text-muted">{b.empNo}</span> <span className="text-ink">{b.employeeName}</span></td>
                    <td className="px-4 py-2.5 text-xs text-heading">Total hours in three weeks</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{fmt(b.from)} – {fmt(b.to)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-600">{h(b.hours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{h(b.limit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {daily.length > 50 && (
            <p className="border-t border-line px-5 py-2 text-xs text-muted">
              Showing the worst 50 of {daily.length} days over the daily cap.
            </p>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">By employee</h2>
          <span className="text-xs text-muted">costliest first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                <th className="px-4 py-2.5 font-semibold">Department</th>
                <th className="px-4 py-2.5 text-right font-semibold">Normal OT</th>
                <th className="px-4 py-2.5 text-right font-semibold">Night / rest day</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total hours</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
                <th className="px-4 py-2.5 text-right font-semibold">Of basic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No overtime in approved payroll for this period.</td></tr>
              )}
              {summary.rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2.5"><span className="text-xs text-muted">{r.empNo}</span> <span className="text-ink">{r.employeeName}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted">{r.department}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{h(r.otHours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{h(r.otPremiumHours)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-heading">{h(r.totalHours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-heading">{n(r.cost)}</td>
                  <td className={clsx("px-4 py-2.5 text-right tabular-nums", r.shareOfBasic > 0.5 ? "font-medium text-brand-gold" : "text-muted")}>
                    {r.basic > 0 ? `${Math.round(r.shareOfBasic * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">What this reads:</span> the cost comes from approved
          payslips, the legality from the attendance record — and an inspection reads the attendance,
          not the payslip. Paying overtime at the right rate does not make an over-long day lawful.
          The caps are on HR Policy, where a company may set a stricter limit than the law but not a
          looser one.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "red" }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx("mt-1 text-2xl font-bold tabular-nums", accent === "red" ? "text-red-600" : "text-heading")}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
