import {
  TrendingUp, Wallet, Boxes, ClipboardCheck, ArrowUpRight, ShieldAlert,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { activeTenant } from "@/config/tenant";

export const dynamic = "force-dynamic";

const aed = (v: number) => `AED ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const toneMap: Record<string, string> = {
  green: "bg-brand-green/10 text-brand-green",
  navy: "bg-brand-navy/10 text-brand-navy",
  blue: "bg-brand-blue/10 text-brand-blue-600",
  gold: "bg-brand-gold/15 text-brand-gold",
};

export default async function DashboardPage() {
  const session = await getSession();
  const companyIds = session?.companies.map((c) => c.id) ?? [];
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  const COMPANIES = tenant
    ? await db.company.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" } })
    : [];

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const soon = new Date(); soon.setDate(soon.getDate() + 60);

  const [openApprovals, accounts, expiringDocs] = await Promise.all([
    db.approvalRequest.count({ where: { companyId: { in: companyIds }, status: "Pending" } }),
    db.chartOfAccount.findMany({
      where: { companyId: { in: companyIds } },
      include: { lines: { include: { entry: { select: { date: true } } } } },
    }),
    // employees whose Emirates ID / Visa / Labour Card expires within 60 days (or already expired)
    db.employee.count({
      where: {
        companyId: { in: companyIds },
        status: { not: "Inactive" },
        OR: [
          { emiratesIdExpiry: { lte: soon } },
          { visaExpiry: { lte: soon } },
          { labourCardExpiry: { lte: soon } },
        ],
      },
    }),
  ]);

  // Group Revenue (YTD): credit balance on Income accounts, this calendar year
  const revenueYtd = accounts
    .filter((a) => a.type === "Income")
    .reduce((s, a) => s + a.lines.reduce((t, l) => (l.entry.date >= yearStart ? t + l.credit - l.debit : t), 0), 0);

  // Cash Position: debit balance on cash / bank / receivable asset accounts (all-time)
  const cashPosition = accounts
    .filter((a) => a.type === "Asset" && /cash|bank|receiv/i.test(a.name))
    .reduce((s, a) => s + a.lines.reduce((t, l) => t + l.debit - l.credit, 0), 0);

  // Each KPI is shown only if the user can view the screen it summarises.
  const ALL_STATS = [
    { perm: "finance.reports", label: "Group Revenue (YTD)", value: aed(revenueYtd), hint: "Income posted across all companies", icon: TrendingUp, tone: "green" },
    { perm: "finance.reports", label: "Cash Position", value: aed(cashPosition), hint: "Combined bank & receivables", icon: Wallet, tone: "navy" },
    { perm: "approvals.inbox", label: "Open Approvals", value: String(openApprovals), hint: "Waiting for sign-off", icon: ClipboardCheck, tone: "blue" },
    { perm: "hr.reports", label: "Docs expiring (60d)", value: String(expiringDocs), hint: "Visa / Emirates ID / Labour Card", icon: ShieldAlert, tone: "gold" },
  ];
  const STATS = ALL_STATS.filter((s) => can(session, s.perm));

  return (
    <div>
      <PageHeader
        title={`Welcome to ${activeTenant.productName} ERP`}
        subtitle="Your group at a glance. Figures populate as data is entered in Phase 1."
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="stat-card">
              <div className="flex items-start justify-between">
                <span className={`grid h-10 w-10 place-items-center rounded-lg ${toneMap[s.tone]}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-line" />
              </div>
              <div className="mt-4 text-2xl font-bold text-ink">{s.value}</div>
              <div className="mt-1 text-sm font-medium text-muted">{s.label}</div>
              <div className="mt-0.5 text-xs text-muted/80">{s.hint}</div>
            </div>
          );
        })}
      </div>

      {/* Group companies */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold text-brand-navy">Group Companies</h2>
            <span className="text-xs text-muted">{COMPANIES.length} companies</span>
          </div>
          <div className="divide-y divide-line">
            {COMPANIES.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-navy text-xs font-bold text-white">
                  {c.code}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">{c.name}</div>
                  <div className="text-xs text-muted">Separate books · consolidated reporting</div>
                </div>
                <span className="rounded-full bg-brand-green/10 px-2.5 py-0.5 text-xs font-medium text-brand-green-700">
                  Active
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-brand-navy">Getting started</h2>
          </div>
          <ul className="space-y-3 p-5 text-sm">
            {[
              "Set up your group companies",
              "Add users and their roles (access control)",
              "Configure the approval sign-off levels",
              "Import your chart of accounts",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-blue/10 text-[11px] font-bold text-brand-blue-600">
                  {i + 1}
                </span>
                <span className="text-ink">{step}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
            <Boxes className="h-4 w-4" /> Phase 1 — Foundation
          </div>
        </div>
      </div>
    </div>
  );
}
