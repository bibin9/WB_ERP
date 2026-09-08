import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { activeTenant } from "@/config/tenant";
import { probationState } from "@/lib/leave";
import { emiratisation, isEmirati, iloeStatus, iloeCategory, middayBreach, inMiddayBanSeason } from "@/lib/compliance";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Row = { emp: string; empNo: string; company: string; docType: string; docNo: string; expiry: Date | null };

function statusOf(expiry: Date | null): { label: string; days: number | null; cls: string } {
  if (!expiry) return { label: "Not on file", days: null, cls: "bg-line text-muted" };
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / DAY);
  if (days < 0) return { label: `Expired ${-days}d ago`, days, cls: "bg-red-50 text-red-600" };
  if (days <= 60) return { label: `${days}d left`, days, cls: "bg-brand-gold/15 text-brand-gold" };
  return { label: `${days}d left`, days, cls: "bg-brand-green/10 text-brand-green-700" };
}

export default async function HrReportsPage() {
  const session = await requireAccess("hr.reports");
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  // Only the companies this user is a member of — never the whole tenant.
  const scope = session.companies.map((c) => c.id);
  const companies = tenant ? await db.company.findMany({ where: { tenantId: tenant.id, id: { in: scope } } }) : [];
  const companyMap = new Map(companies.map((c) => [c.id, c.code]));

  const employees = await db.employee.findMany({
    where: { companyId: { in: companies.map((c) => c.id) }, status: { not: "Inactive" } },
    orderBy: { empNo: "asc" },
  });
  const certs = await db.certification.findMany({
    where: { companyId: { in: companies.map((c) => c.id) }, expiryDate: { not: null } },
    include: { employee: { select: { name: true, empNo: true } } },
  });

  // Flatten UAE documents into one row per (employee, document)
  const docRows: Row[] = [];
  for (const e of employees) {
    const co = companyMap.get(e.companyId) ?? "—";
    docRows.push({ emp: e.name, empNo: e.empNo, company: co, docType: "Emirates ID", docNo: e.emiratesIdNo ?? "—", expiry: e.emiratesIdExpiry });
    docRows.push({ emp: e.name, empNo: e.empNo, company: co, docType: "Visa", docNo: e.visaNo ?? "—", expiry: e.visaExpiry });
    docRows.push({ emp: e.name, empNo: e.empNo, company: co, docType: "Labour Card", docNo: e.labourCardNo ?? "—", expiry: e.labourCardExpiry });
    docRows.push({ emp: e.name, empNo: e.empNo, company: co, docType: "Passport", docNo: e.passportNo ?? "—", expiry: e.passportExpiry });
  }
  // Only rows that have an expiry date, sorted soonest first (expired at top)
  const dated = docRows.filter((r) => r.expiry).sort((a, b) => new Date(a.expiry!).getTime() - new Date(b.expiry!).getTime());

  const expired = dated.filter((r) => statusOf(r.expiry).days! < 0).length;
  const expiring = dated.filter((r) => { const d = statusOf(r.expiry).days!; return d >= 0 && d <= 60; }).length;

  const certRows = certs
    .map((c) => ({ emp: c.employee.name, empNo: c.employee.empNo, name: c.name, category: c.category, expiry: c.expiryDate }))
    .sort((a, b) => new Date(a.expiry!).getTime() - new Date(b.expiry!).getTime());
  const certAlerts = certRows.filter((c) => statusOf(c.expiry).days! <= 60).length;

  // Manpower summary
  const total = employees.length;
  const supplied = employees.filter((e) => e.employmentType === "Supplied").length;
  const own = total - supplied;
  const byCompany = companies.map((c) => ({
    code: c.code, name: c.name,
    count: employees.filter((e) => e.companyId === c.id).length,
    supplied: employees.filter((e) => e.companyId === c.id && e.employmentType === "Supplied").length,
  }));

  // Anyone whose probation is running out, or has run out with nobody
  // recording a decision. A cleared probation drops off the list.
  const today = new Date();

  // Emiratisation, per company: the rule that applies turns on headcount, and
  // whether the company trades in one of the fourteen sectors MOHRE has named.
  const emiratisationByCompany = companies.map((co) => {
    const staff = employees.filter((e) => e.companyId === co.id && e.status !== "Inactive");
    const nationals = staff.filter((e) => isEmirati(e.nationality));
    return {
      co,
      nationalNames: nationals.map((e) => `${e.name} (${e.empNo})`),
      result: emiratisation({
        headcount: staff.length,
        skilledCount: staff.filter((e) => e.skilledRole).length,
        nationals: nationals.length,
        prioritySector: co.emiratisationSector,
      }),
    };
  });

  // ILOE: who still has to subscribe, and who has let it lapse. Exempt people
  // drop off, or the list stops being read.
  const iloe = employees
    .filter((e) => e.status !== "Inactive")
    .map((e) => ({ e, st: iloeStatus(e, today), cat: iloeCategory(e.basicSalary) }))
    .filter(({ st }) => !st.ok || st.expiringSoon);

  // The summer midday ban. Only the punch data can show whether somebody was on
  // site across it — and only the punch data can show that nobody was.
  const banSeason = inMiddayBanSeason(today);
  const middayRows = banSeason
    ? (
        await db.attendance.findMany({
          where: {
            companyId: { in: scope },
            firstIn: { not: null },
            date: { gte: new Date(today.getTime() - 60 * DAY) },
          },
          include: { employee: { select: { name: true, empNo: true } } },
          orderBy: { date: "desc" },
          take: 400,
        })
      )
        .map((a) => ({ a, br: middayBreach(a.date, a.firstIn, a.lastOut) }))
        .filter(({ br }) => br.spansBreak)
        .slice(0, 25)
    : [];
  const probationDue = employees
    .filter((e) => e.probationEndDate && !e.probationCleared)
    .map((e) => ({ e, st: probationState(e.probationEndDate, today) }))
    .filter(({ st }) => st.overdue || st.endingSoon)
    .sort((a, b) => (a.st.daysRemaining ?? 0) - (b.st.daysRemaining ?? 0));

  return (
    <div>
      <PageHeader title="HR — Compliance & Expiry" subtitle="Visa, Emirates ID, Labour Card, Passport & certification expiry — plus manpower summary." />
      <HrTabs />

      {/* Alert cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="stat-card"><div className="text-2xl font-bold text-red-600">{expired}</div><div className="text-sm text-muted">Documents expired</div></div>
        <div className="stat-card"><div className="text-2xl font-bold text-brand-gold">{expiring}</div><div className="text-sm text-muted">Expiring ≤ 60 days</div></div>
        <div className="stat-card"><div className="text-2xl font-bold text-heading">{certAlerts}</div><div className="text-sm text-muted">Certs due/expired</div></div>
        <div className="stat-card"><div className="text-2xl font-bold text-ink">{total}</div><div className="text-sm text-muted">Active headcount</div></div>
        <div className="stat-card">
          <div className={probationDue.length ? "text-2xl font-bold text-brand-gold" : "text-2xl font-bold text-ink"}>{probationDue.length}</div>
          <div className="text-sm text-muted">Probation decisions due</div>
        </div>
      </div>

      {/* Emiratisation.
          The bill arrives once a year and is the size of a salary, so the
          number that matters is the shortfall, not the headcount. */}
      <div className="card mb-5">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Emiratisation</h2>
        </div>
        <div className="divide-y divide-line">
          {emiratisationByCompany.map(({ co, result, nationalNames }) => (
            <div key={co.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-ink">{co.code}</span>
                <span className="text-xs text-muted">{co.name}</span>
                {result.applies && (
                  <span
                    className={
                      "ml-auto rounded px-2 py-0.5 text-xs font-medium " +
                      (result.shortfall > 0
                        ? "bg-brand-gold/15 text-brand-gold"
                        : "bg-brand-green/10 text-brand-green-700")
                    }
                  >
                    {result.shortfall > 0
                      ? `${result.shortfall} short of ${result.required}`
                      : `${result.nationals} of ${result.required} — met`}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">{result.note}</p>
              {result.applies && result.shortfall > 0 && (
                <p className="mt-1 text-xs text-brand-gold">
                  Exposure about AED {result.exposure.toLocaleString("en-AE")}
                  {"monthlyExposure" in result && result.monthlyExposure
                    ? ` a year (AED ${result.monthlyExposure.toLocaleString("en-AE")} a month per unfilled position)`
                    : ", collected as a one-off contribution per missing hire"}
                  .
                </p>
              )}
              {nationalNames.length > 0 && (
                <p className="mt-1 text-xs text-muted">Counted: {nationalNames.join(", ")}</p>
              )}
            </div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          UAE nationals are counted from the nationality on each record, and the names counted are listed
          above &mdash; a nationality spelled another way is invisible otherwise, and a count that is
          quietly one short is the expensive kind of wrong. Mark the company as a priority sector on its
          record if it trades in construction, real estate, healthcare, hospitality or one of the other
          named sectors.
        </p>
      </div>

      {/* ILOE. The fine lands on the employee; the blocked work permit lands
          on the employer, which is why HR chases it. */}
      {iloe.length > 0 && (
        <div className="card mb-5 overflow-x-auto">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Unemployment insurance (ILOE) &mdash; {iloe.length} to chase</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                <th className="px-4 py-2 font-semibold">Employee</th>
                <th className="px-4 py-2 font-semibold">Band</th>
                <th className="px-4 py-2 text-right font-semibold">Premium</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {iloe.map(({ e, st, cat }) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-ink">
                    {e.name} <span className="font-mono text-xs text-muted">{e.empNo}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">Category {cat.category}</td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums text-muted">
                    AED {cat.monthly}/mo
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        "rounded px-2 py-0.5 text-xs font-medium " +
                        (st.ok ? "bg-brand-blue/10 text-brand-blue-600" : "bg-brand-gold/15 text-brand-gold")
                      }
                    >
                      {st.reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The summer midday ban. */}
      {banSeason && (
        <div className="card mb-5 overflow-x-auto">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Midday break &mdash; 15 June to 15 September</h2>
          </div>
          {middayRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              No punch record in the last sixty days shows anybody on site across 12:30&ndash;15:00. That is
              the evidence, not just the absence of a complaint.
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">Employee</th>
                    <th className="px-4 py-2 font-semibold">On site</th>
                    <th className="px-4 py-2 text-right font-semibold">Across the break</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {middayRows.map(({ a, br }) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 text-ink">{fmt(a.date)}</td>
                      <td className="px-4 py-2 text-ink">
                        {a.employee.name} <span className="font-mono text-xs text-muted">{a.employee.empNo}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">
                        {a.firstIn?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        &ndash;
                        {a.lastOut?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums text-brand-gold">{br.hours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-5 py-3 text-xs text-muted">
                These are days to look at, not breaches. The punches show the man was on site across the
                break; they do not show whether he was outdoors in the sun, and an electrician in a plant
                room is not in breach. Where the work was outdoors, it is.
              </p>
            </>
          )}
        </div>
      )}

      {/* Probation.
          The date matters twice and both are easy to miss: a confirm-or-release
          decision is due before it passes, and the moment it does the notice
          period changes from fourteen days to whatever the contract says. */}
      {probationDue.length > 0 && (
        <div className="card mb-5 overflow-x-auto">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">Probation — a decision is due</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                <th className="px-4 py-2 font-semibold">Employee</th>
                <th className="px-4 py-2 font-semibold">Company</th>
                <th className="px-4 py-2 font-semibold">Joined</th>
                <th className="px-4 py-2 font-semibold">Probation ends</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {probationDue.map(({ e, st }) => (
                <tr key={e.id} className={st.overdue ? "bg-brand-gold/5" : ""}>
                  <td className="px-4 py-2 text-ink">
                    {e.name} <span className="font-mono text-xs text-muted">{e.empNo}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{companyMap.get(e.companyId) ?? ""}</td>
                  <td className="px-4 py-2 text-xs text-muted">{fmt(e.joinDate)}</td>
                  <td className="px-4 py-2 text-ink">{fmt(e.probationEndDate)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        "rounded px-2 py-0.5 text-xs font-medium " +
                        (st.overdue ? "bg-brand-gold/15 text-brand-gold" : "bg-brand-blue/10 text-brand-blue-600")
                      }
                    >
                      {st.overdue
                        ? `Ended ${-st.daysRemaining!}d ago, not confirmed`
                        : `Ends in ${st.daysRemaining}d`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            Probation is six months at most and cannot be extended. While it runs the notice period is
            fourteen days; once it has passed the contract&rsquo;s notice applies. Tick &ldquo;Probation
            cleared&rdquo; on the employee record once a decision has been taken.
          </p>
        </div>
      )}

      {/* Document expiry table */}
      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Document expiry (soonest first)</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Number</th>
                <th className="px-4 py-3 font-semibold">Expiry</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dated.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No document expiry dates on file yet. Add them on each employee profile.</td></tr>
              )}
              {dated.map((r, i) => {
                const st = statusOf(r.expiry);
                return (
                  <tr key={i} className="hover:bg-brand-paper/60">
                    <td className="px-4 py-3"><span className="font-medium text-ink">{r.emp}</span> <span className="font-mono text-xs text-muted">{r.empNo}</span></td>
                    <td className="px-4 py-3"><span className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs font-medium text-heading">{r.company}</span></td>
                    <td className="px-4 py-3 text-ink">{r.docType}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{r.docNo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink">{fmt(r.expiry)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Certification expiry */}
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Certification & medical expiry</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Certificate</th>
                  <th className="px-4 py-3 font-semibold">Expiry</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {certRows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No certifications with expiry dates.</td></tr>
                )}
                {certRows.map((c, i) => {
                  const st = statusOf(c.expiry);
                  return (
                    <tr key={i} className="hover:bg-brand-paper/60">
                      <td className="px-4 py-3"><span className="font-medium text-ink">{c.emp}</span> <span className="font-mono text-xs text-muted">{c.empNo}</span></td>
                      <td className="px-4 py-3 text-ink">{c.name} <span className="text-xs text-muted">({c.category})</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink">{fmt(c.expiry)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Manpower summary */}
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Manpower summary</h2></div>
          <div className="grid grid-cols-2 gap-4 p-5">
            <div className="rounded-lg bg-brand-paper p-4"><div className="text-2xl font-bold text-ink">{own}</div><div className="text-sm text-muted">Own employees</div></div>
            <div className="rounded-lg bg-brand-paper p-4"><div className="text-2xl font-bold text-brand-gold">{supplied}</div><div className="text-sm text-muted">Supplied manpower</div></div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold">Company</th>
                <th className="px-4 py-2.5 text-right font-semibold">Headcount</th>
                <th className="px-4 py-2.5 text-right font-semibold">Supplied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byCompany.map((c) => (
                <tr key={c.code}>
                  <td className="px-4 py-2.5"><span className="font-medium text-ink">{c.code}</span> <span className="text-xs text-muted">{c.name}</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{c.count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-brand-gold">{c.supplied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-brand-blue/5 p-3 text-xs text-muted">
        <span className="font-medium text-ink">Why this matters:</span> in the UAE, working on an expired visa, Emirates ID or labour card carries fines and stop-work risk.
        Anything expiring within 60 days is flagged amber; expired items are red. Renew and update the expiry on the employee profile to clear the alert.
      </div>
    </div>
  );
}
