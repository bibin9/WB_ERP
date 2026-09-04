import Link from "next/link";
import {
  TrendingUp, Wallet, ClipboardCheck, ShieldAlert, ArrowUpRight, ArrowRight,
  Receipt, Users, IdCard, BadgeCheck, CalendarDays, ClipboardList, Building2,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { activeTenant } from "@/config/tenant";

export const dynamic = "force-dynamic";
const aed = (v: number) => `AED ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const toneMap: Record<string, string> = {
  green: "bg-brand-green/10 text-brand-green", navy: "bg-brand-navy/10 text-brand-navy",
  blue: "bg-brand-blue/10 text-brand-blue-600", gold: "bg-brand-gold/15 text-brand-gold",
};
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  const companyIds = session.companies.map((c) => c.id);
  const roles = Array.from(new Set(session.companies.map((c) => c.role)));
  const isAdmin = session.isAdmin;
  const show = { finance: can(session, "finance"), hr: can(session, "hr"), approvals: can(session, "approvals"), companies: can(session, "companies") };

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const in60 = new Date(now.getTime() + 60 * 86400000);

  // ---- Finance ----
  let fin: { income: number; expense: number; netProfit: number; cash: number; netVat: number } | null = null;
  if (show.finance) {
    const accounts = await db.chartOfAccount.findMany({ where: { companyId: { in: companyIds } }, include: { lines: { include: { entry: { select: { date: true } } } } } });
    const bal = (a: (typeof accounts)[number]) => a.lines.reduce((s, l) => s + l.debit - l.credit, 0);
    const income = accounts.filter((a) => a.type === "Income").reduce((s, a) => s + a.lines.reduce((t, l) => (l.entry.date >= yearStart ? t + l.credit - l.debit : t), 0), 0);
    const expense = accounts.filter((a) => a.type === "Expense").reduce((s, a) => s + a.lines.reduce((t, l) => (l.entry.date >= yearStart ? t + l.debit - l.credit : t), 0), 0);
    const cash = accounts.filter((a) => a.type === "Asset" && /cash|bank|receiv/i.test(a.name)).reduce((s, a) => s + bal(a), 0);
    const vat = await db.journalEntry.findMany({ where: { companyId: { in: companyIds }, vatAmount: { gt: 0 } }, select: { voucherType: true, vatAmount: true } });
    const outVat = vat.filter((v) => ["Sales", "Receipt"].includes(v.voucherType)).reduce((s, v) => s + v.vatAmount, 0);
    const inVat = vat.filter((v) => ["Purchase", "Payment"].includes(v.voucherType)).reduce((s, v) => s + v.vatAmount, 0);
    fin = { income, expense, netProfit: income - expense, cash, netVat: outVat - inVat };
  }

  // ---- HR ----
  let hr: { headcount: number; supplied: number; docs: { name: string; label: string; date: Date }[]; certs: number; pendingLeave: number; openTasks: number } | null = null;
  if (show.hr) {
    const emps = await db.employee.findMany({ where: { companyId: { in: companyIds }, status: { not: "Inactive" } }, select: { name: true, employmentType: true, emiratesIdExpiry: true, visaExpiry: true, labourCardExpiry: true } });
    const docs: { name: string; label: string; date: Date }[] = [];
    for (const e of emps) {
      const add = (l: string, d: Date | null) => { if (d && d <= in60) docs.push({ name: e.name, label: l, date: d }); };
      add("Emirates ID", e.emiratesIdExpiry); add("Visa", e.visaExpiry); add("Labour Card", e.labourCardExpiry);
    }
    docs.sort((a, b) => a.date.getTime() - b.date.getTime());
    const certs = await db.certification.count({ where: { companyId: { in: companyIds }, expiryDate: { not: null, lte: in60 } } });
    const pendingLeave = await db.leaveRequest.count({ where: { companyId: { in: companyIds }, status: "Pending" } });
    const openTasks = await db.jobAssignment.count({ where: { companyId: { in: companyIds }, status: { notIn: ["Closed", "Completed"] } } });
    hr = { headcount: emps.length, supplied: emps.filter((e) => e.employmentType === "Supplied").length, docs, certs, pendingLeave, openTasks };
  }

  // ---- Approvals ----
  let appr: { count: number; pending: { id: string; title: string; docType: string; company: { code: string } }[] } | null = null;
  if (show.approvals) {
    const pending = await db.approvalRequest.findMany({ where: { companyId: { in: companyIds }, status: "Pending" }, orderBy: { createdAt: "desc" }, take: 5, include: { company: true } });
    const count = await db.approvalRequest.count({ where: { companyId: { in: companyIds }, status: "Pending" } });
    appr = { count, pending };
  }

  // ---- Group (admin) ----
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  const companies = show.companies && tenant ? await db.company.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" } }) : [];
  const userCount = isAdmin && tenant ? await db.user.count({ where: { tenantId: tenant.id } }) : 0;

  // ---- Title adapts to access ----
  const title = isAdmin ? "Group Dashboard"
    : show.finance && !show.hr ? "Finance Dashboard"
    : show.hr && !show.finance ? "HR Dashboard"
    : "Dashboard";

  // ---- KPI cards (only those the user can see) ----
  const STATS = [
    fin && { label: "Group Revenue (YTD)", value: aed(fin.income), hint: "Income posted across your companies", icon: TrendingUp, tone: "green" },
    fin && { label: "Cash Position", value: aed(fin.cash), hint: "Combined bank & receivables", icon: Wallet, tone: "navy" },
    appr && { label: "Open Approvals", value: String(appr.count), hint: "Waiting for sign-off", icon: ClipboardCheck, tone: "blue" },
    hr && { label: "Docs expiring (60d)", value: String(hr.docs.length), hint: "Visa / Emirates ID / Labour Card", icon: ShieldAlert, tone: "gold" },
  ].filter(Boolean) as { label: string; value: string; hint: string; icon: typeof TrendingUp; tone: string }[];

  return (
    <div>
      <PageHeader title={`Welcome to ${title === "Group Dashboard" ? activeTenant.productName + " ERP" : title}`}
        subtitle={`Signed in as ${session.user.name}${roles.length ? " · " + roles.join(", ") : ""}. Your view is tailored to your access.`} />

      {/* KPI cards */}
      {STATS.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="stat-card">
                <div className="flex items-start justify-between">
                  <span className={`grid h-10 w-10 place-items-center rounded-lg ${toneMap[s.tone]}`}><Icon className="h-5 w-5" /></span>
                  <ArrowUpRight className="h-4 w-4 text-line" />
                </div>
                <div className="mt-4 text-2xl font-bold text-ink">{s.value}</div>
                <div className="mt-1 text-sm font-medium text-muted">{s.label}</div>
                <div className="mt-0.5 text-xs text-muted/80">{s.hint}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Module panels */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* FINANCE */}
        {fin && (
          <Panel title="Finance" icon={Wallet} href="/finance" tone="navy">
            <div className="grid grid-cols-3 gap-3">
              <Mini label="Income (YTD)" value={aed(fin.income)} />
              <Mini label="Expenses (YTD)" value={aed(fin.expense)} />
              <Mini label="Net profit" value={aed(fin.netProfit)} accent={fin.netProfit >= 0 ? "green" : "red"} />
            </div>
            <Line icon={Receipt} label="Net VAT payable to FTA" value={aed(fin.netVat)} accent={fin.netVat > 0 ? "gold" : "green"} />
          </Panel>
        )}

        {/* HR */}
        {hr && (
          <Panel title="Human Resources" icon={Users} href="/hr" tone="green">
            <div className="grid grid-cols-3 gap-3">
              <Mini label="Active staff" value={String(hr.headcount)} sub={hr.supplied ? `${hr.supplied} supplied` : undefined} />
              <Mini label="Docs expiring" value={String(hr.docs.length)} accent={hr.docs.length ? "gold" : undefined} />
              <Mini label="Pending leave" value={String(hr.pendingLeave)} />
            </div>
            {hr.docs.length > 0 && (
              <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                {hr.docs.slice(0, 4).map((d, i) => {
                  const days = Math.ceil((d.date.getTime() - now.getTime()) / 86400000);
                  return (
                    <Link key={i} href="/hr/reports" className="flex items-center justify-between px-3 py-2 text-sm hover:bg-brand-paper">
                      <span><IdCard className="mr-1.5 inline h-3.5 w-3.5 text-muted" />{d.name} · {d.label}</span>
                      <span className={days < 0 ? "text-xs font-medium text-red-600" : "text-xs font-medium text-brand-gold"}>{days < 0 ? `expired` : `${days}d`}</span>
                    </Link>
                  );
                })}
              </div>
            )}
            {hr.certs > 0 && <Line icon={BadgeCheck} label="Certificates expiring / expired" value={String(hr.certs)} accent="gold" href="/hr/certifications" />}
            {hr.openTasks > 0 && <Line icon={ClipboardList} label="Open job assignments" value={String(hr.openTasks)} href="/hr/tasks" />}
          </Panel>
        )}

        {/* APPROVALS */}
        {appr && (
          <Panel title="Approvals" icon={ClipboardCheck} href="/approvals" tone="blue">
            {appr.count === 0 ? (
              <p className="py-4 text-center text-sm text-muted">Nothing waiting. 🎉</p>
            ) : (
              <div className="divide-y divide-line rounded-lg border border-line">
                {appr.pending.map((p) => (
                  <Link key={p.id} href="/approvals" className="flex items-center justify-between px-3 py-2 text-sm hover:bg-brand-paper">
                    <span className="text-ink">{p.title}</span>
                    <span className="text-xs text-muted">{p.company.code} · {p.docType}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        )}

        {/* GROUP / ADMIN */}
        {show.companies && companies.length > 0 && (
          <Panel title="Group Companies" icon={Building2} href="/companies" tone="navy" note={`${companies.length} companies${isAdmin ? ` · ${userCount} users` : ""}`}>
            <div className="divide-y divide-line">
              {companies.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-navy text-[10px] font-bold text-white">{c.code}</span>
                  <span className="flex-1 text-sm text-ink">{c.name}</span>
                  <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-brand-green-700">Active</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {STATS.length === 0 && !fin && !hr && !appr && companies.length === 0 && (
        <div className="card p-10 text-center text-muted">Your dashboard has no panels yet — your role has limited access. Use the sidebar to open the screens you can access.</div>
      )}
    </div>
  );
}

/* ---- presentational helpers ---- */
function Panel({ title, icon: Icon, href, tone, note, children }: { title: string; icon: typeof Wallet; href: string; tone: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-brand-navy">
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${toneMap[tone]}`}><Icon className="h-4 w-4" /></span>
          <h2 className="font-semibold">{title}</h2>
          {note && <span className="text-xs text-muted">· {note}</span>}
        </div>
        <Link href={href} className="flex items-center gap-1 text-sm font-medium text-brand-blue-600 hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      {children}
    </div>
  );
}
function Mini({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  const color = accent === "green" ? "text-brand-green-700" : accent === "red" ? "text-red-600" : accent === "gold" ? "text-brand-gold" : "text-ink";
  return (
    <div className="rounded-lg bg-brand-paper p-3">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {sub && <div className="text-[11px] text-muted/80">{sub}</div>}
    </div>
  );
}
function Line({ icon: Icon, label, value, accent, href }: { icon: typeof Receipt; label: string; value: string; accent?: string; href?: string }) {
  const color = accent === "gold" ? "text-brand-gold" : accent === "green" ? "text-brand-green-700" : "text-ink";
  const body = (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted"><Icon className="h-4 w-4" /> {label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}
