import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import HrTabs from "@/components/HrTabs";
import { Tile, Tiles, Section, Sections, Figure, Figures, Line, List, Bars, NothingToShow, plural, daysFrom, dueText } from "@/components/dashboards/Kit";
import { companyScope } from "@/lib/company-scope";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

/**
 * HR at a glance: who is here today, who is away, what is waiting for a
 * decision, and which documents lapse soon. No salary figure appears here —
 * pay stays on the payroll screen, for those who may open it.
 */
export default async function HrDashboard({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireAccess("hr");
  const scoped = companyScope(session.companies, (await searchParams).c);
  const ids = scoped.ids;
  const inScope = { companyId: { in: ids } };

  const g = {
    employees: can(session, "hr.employees"),
    attendance: can(session, "hr.attendance"),
    leave: can(session, "hr.leave"),
    reports: can(session, "hr.reports"),
    certs: can(session, "hr.certifications"),
    payroll: can(session, "hr.payroll"),
    overtime: can(session, "hr.overtime"),
    manhours: can(session, "hr.manhours"),
    separation: can(session, "hr.separation"),
    onboarding: can(session, "hr.onboarding"),
    tasks: can(session, "hr.tasks"),
  };

  const now = new Date();
  // Attendance and timesheets are kept by calendar day, stored as midnight UTC.
  const today = new Date(now.toISOString().slice(0, 10));
  const tomorrow = new Date(today.getTime() + 86400000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const in60 = new Date(today.getTime() + 61 * 86400000);

  const [byStatus, byType, joiners, muster, pendingLeave, awayToday, people, certs, runs, month, hours, separations, requisitions, candidates, tasks] = await Promise.all([
    g.employees || g.attendance ? db.employee.groupBy({ by: ["status"], where: inScope, _count: true }) : null,
    g.employees ? db.employee.groupBy({ by: ["employmentType"], where: { ...inScope, status: { not: "Inactive" } }, _count: true }) : null,
    g.employees ? db.employee.count({ where: { ...inScope, joinDate: { gte: monthStart } } }) : null,
    g.attendance ? db.attendance.groupBy({ by: ["status"], where: { ...inScope, date: { gte: today, lt: tomorrow } }, _count: true }) : null,
    g.leave
      ? db.leaveRequest.findMany({ where: { ...inScope, status: "Pending" }, orderBy: { fromDate: "asc" }, select: { id: true, type: true, fromDate: true, days: true, employee: { select: { name: true } } } })
      : null,
    g.leave ? db.leaveRequest.count({ where: { ...inScope, status: "Approved", fromDate: { lt: tomorrow }, toDate: { gte: today } } }) : null,
    g.reports
      ? db.employee.findMany({
          where: { ...inScope, status: { not: "Inactive" }, OR: [{ visaExpiry: { lt: in60 } }, { emiratesIdExpiry: { lt: in60 } }, { labourCardExpiry: { lt: in60 } }, { passportExpiry: { lt: in60 } }] },
          select: { id: true, name: true, visaExpiry: true, emiratesIdExpiry: true, labourCardExpiry: true, passportExpiry: true },
        })
      : null,
    g.certs ? db.certification.findMany({ where: { ...inScope, expiryDate: { not: null, lt: in60 } }, select: { expiryDate: true } }) : null,
    g.payroll
      ? db.payrollRun.findMany({ where: inScope, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, period: true, status: true, company: { select: { code: true } } } })
      : null,
    g.overtime ? db.attendance.aggregate({ where: { ...inScope, date: { gte: monthStart, lt: tomorrow } }, _sum: { otHours: true } }) : null,
    g.manhours ? db.timesheet.aggregate({ where: { ...inScope, date: { gte: monthStart, lt: tomorrow } }, _sum: { hours: true } }) : null,
    g.separation ? db.separation.groupBy({ by: ["status"], where: { ...inScope, status: { in: ["Draft", "Approved"] } }, _count: true }) : null,
    g.onboarding ? db.requisition.aggregate({ where: { ...inScope, status: { in: ["Open", "Interviewing", "Offered"] } }, _count: true, _sum: { headcount: true } }) : null,
    g.onboarding ? db.candidate.count({ where: { requisition: inScope, stage: { in: ["Applied", "Interview", "Offer"] } } }) : null,
    g.tasks ? db.jobAssignment.findMany({ where: { ...inScope, status: { in: ["Open", "In Progress"] } }, select: { dueDate: true } }) : null,
  ]);

  const count = (rows: { _count: number; [k: string]: unknown }[] | null, key: string, value: string) =>
    rows?.find((r) => r[key] === value)?._count ?? 0;
  const active = count(byStatus, "status", "Active");
  const onLeave = count(byStatus, "status", "On Leave");
  const onBooks = active + onLeave;

  const marked = muster?.reduce((s, r) => s + r._count, 0) ?? 0;
  const present = count(muster, "status", "Present") + count(muster, "status", "Half-day");
  const absent = count(muster, "status", "Absent");

  // Each lapsing document, soonest first.
  const docs = (people ?? []).flatMap((p) =>
    ([["Visa", p.visaExpiry], ["Emirates ID", p.emiratesIdExpiry], ["Labour card", p.labourCardExpiry], ["Passport", p.passportExpiry]] as const)
      .filter(([, d]) => d && d < in60)
      .map(([label, d]) => ({ key: `${p.id}-${label}`, name: p.name, label, days: daysFrom(d as Date, today) })),
  ).sort((a, b) => a.days - b.days);
  const docsExpired = docs.filter((d) => d.days < 0).length;
  const certsExpired = certs?.filter((c) => (c.expiryDate as Date) < today).length ?? 0;
  const tasksOverdue = tasks?.filter((t) => t.dueDate && t.dueDate < today).length ?? 0;

  const anything = Object.values(g).some(Boolean);

  return (
    <div>
      <PageHeader title="HR Dashboard" subtitle="Who is here today, who is away, what is waiting for a decision, and which documents lapse soon." />
      <div className="mb-5"><CompanyPicker companies={session.companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={scoped.current} allowAll label="Figures for:" /></div>
      <HrTabs />

      {!anything && <NothingToShow />}

      <Tiles>
        {g.employees && <Tile label="On the books" value={String(onBooks)} hint={onLeave ? `${active} working · ${onLeave} on leave` : "Active employees"} href="/hr" />}
        {muster && (
          <Tile
            label="Present today"
            value={String(present)}
            hint={marked < onBooks ? `${onBooks - marked} not yet marked on today's muster` : `${absent} absent · muster complete`}
            tone={marked < onBooks ? "warn" : "good"}
            href="/hr/attendance"
          />
        )}
        {pendingLeave && <Tile label="Leave to decide" value={String(pendingLeave.length)} hint={`Requests waiting · ${awayToday ?? 0} away today`} tone={pendingLeave.length ? "warn" : "neutral"} href="/hr/leave" />}
        {people && <Tile label="Documents lapsing" value={String(docs.length)} hint={docsExpired ? `${docsExpired} already expired · next 60 days` : "Visa, Emirates ID, labour card or passport in the next 60 days"} tone={docsExpired ? "bad" : docs.length ? "warn" : "good"} href="/hr/reports" />}
      </Tiles>

      <Sections>
        {people && (
          <Section title="Documents to renew" hint="Soonest first. An expired visa or labour card stops someone working legally." href="/hr/reports">
            <List
              empty="Nothing lapses in the next 60 days."
              rows={docs.slice(0, 6).map((d) => ({ key: d.key, href: "/hr/reports", label: `${d.name} · ${d.label}`, right: d.days < 0 ? `expired ${-d.days}d ago` : dueText(d.days), tone: d.days < 0 ? "bad" : "warn" }))}
            />
          </Section>
        )}

        {pendingLeave && (
          <Section title="Leave waiting for a decision" hint="The earliest start date first — someone may be planning to travel." href="/hr/leave">
            <List
              empty="No leave requests are waiting."
              rows={pendingLeave.slice(0, 6).map((l) => {
                const d = daysFrom(l.fromDate, today);
                return { key: l.id, href: "/hr/leave", label: `${l.employee.name} · ${l.type} · ${plural(l.days, "day")}`, right: `from ${DAY.format(l.fromDate)}`, tone: d <= 3 ? "warn" : "neutral" };
              })}
            />
          </Section>
        )}

        {muster && (
          <Section title="Today's muster" hint="From the attendance marked for today." href="/hr/attendance">
            <Figures>
              <Figure label="Present" value={String(present)} tone="good" sub={count(muster, "status", "Half-day") ? `${count(muster, "status", "Half-day")} half-day` : undefined} />
              <Figure label="Absent" value={String(absent)} tone={absent ? "warn" : "neutral"} />
              <Figure label="On leave / off" value={String(count(muster, "status", "Leave") + count(muster, "status", "Off"))} />
            </Figures>
            {marked < onBooks && <Line label="Not yet marked today" value={String(onBooks - marked)} href="/hr/attendance" tone="warn" />}
          </Section>
        )}

        {byType && byType.length > 0 && (
          <Section title="Workforce" hint="Everyone not marked inactive, by how they are employed." href="/hr/workforce">
            <Bars rows={byType.map((t) => ({ label: t.employmentType, value: t._count })).sort((a, b) => b.value - a.value)} />
            {joiners !== null && joiners > 0 && <Line label="Joined this month" value={String(joiners)} href="/hr" tone="good" />}
          </Section>
        )}

        {runs && (
          <Section title="Payroll" hint="The latest runs. HR prepares a run; the Finance Controller approves it." href="/hr/payroll">
            <List
              empty="No payroll has been run yet."
              rows={runs.map((r) => ({ key: r.id, href: "/hr/payroll", label: `${r.period} · ${r.company.code}`, right: r.status, tone: r.status === "Paid" ? "good" : r.status === "Draft" ? "warn" : "neutral" }))}
            />
          </Section>
        )}

        {(month || hours) && (
          <Section title="Hours this month" hint="Since the 1st, from attendance and the job timesheets.">
            <Figures>
              {month && <Figure label="Overtime hours" value={(month._sum.otHours ?? 0).toLocaleString()} />}
              {hours && <Figure label="Hours booked to jobs" value={(hours._sum.hours ?? 0).toLocaleString()} />}
            </Figures>
            {month && <Line label="Overtime" value="Open" href="/hr/overtime" />}
            {hours && <Line label="Manhours by job" value="Open" href="/hr/manhours" />}
          </Section>
        )}

        {(certs || tasks) && (
          <Section title="Site readiness" hint="Tickets and competency cards, and the work assigned to people.">
            {certs && <Line label={`Certificates lapsing in 60 days${certsExpired ? ` (${certsExpired} expired)` : ""}`} value={String(certs.length)} href="/hr/certifications" tone={certsExpired ? "bad" : certs.length ? "warn" : "neutral"} />}
            {tasks && <Line label={`Open job assignments${tasksOverdue ? ` (${tasksOverdue} past due)` : ""}`} value={String(tasks.length)} href="/hr/tasks" tone={tasksOverdue ? "warn" : "neutral"} />}
          </Section>
        )}

        {(requisitions || separations) && (
          <Section title="Joiners and leavers" hint="Open vacancies, and final settlements not yet paid.">
            {requisitions && <Line label={`Open vacancies · ${plural(candidates ?? 0, "candidate")} in progress`} value={String(requisitions._sum.headcount ?? 0)} href="/hr/onboarding" />}
            {separations && <Line label="Settlements to approve" value={String(count(separations, "status", "Draft"))} href="/hr/separation" tone={count(separations, "status", "Draft") ? "warn" : "neutral"} />}
            {separations && <Line label="Approved, not yet settled" value={String(count(separations, "status", "Approved"))} href="/hr/separation" />}
          </Section>
        )}
      </Sections>
    </div>
  );
}
