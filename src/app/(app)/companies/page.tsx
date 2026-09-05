import { Building2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyForm from "@/components/CompanyForm";
import ActiveToggle from "@/components/ActiveToggle";
import GuardedDelete from "@/components/GuardedDelete";
import { toggleCompanyActive, deleteCompany } from "@/app/(app)/companies/actions";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/guard";
import { canAdminister } from "@/lib/auth";
import { activeTenant } from "@/config/tenant";
import { ExportAllButton } from "@/components/ExportButton";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const session = await requireAccess("companies.list");
  const isAdmin = await canAdminister();
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  const companies = tenant
    ? await db.company.findMany({
        where: { tenantId: tenant.id },
        include: { _count: { select: { memberships: true, jobAssignments: true } } },
        orderBy: { code: "asc" },
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Companies & Group"
        subtitle="Each company keeps its own books; the group consolidates. Add or manage group companies here."
      >
        <CompanyForm />
      </PageHeader>

      {isAdmin && session.companies.length > 0 && (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold text-heading">Export all data</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Download every record for one company as a ZIP of spreadsheets — employees, payroll, leave,
              attendance, certifications, settlements and the books. For your own records, an auditor, or moving
              data elsewhere. It is not a system backup, and it holds personal data, so store it securely.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.companies.map((c) => (
              <ExportAllButton key={c.id} companyId={c.id} label={c.code} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => (
          <div key={c.id} className="card p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-navy text-sm font-bold text-white">
                {c.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink">{c.name}</div>
                <div className="text-xs text-muted">Legal entity · own ledger</div>
              </div>
              <div className="flex items-center gap-0.5">
                <CompanyForm company={{ id: c.id, name: c.name, baseCurrency: c.baseCurrency, fyStartMonth: c.fyStartMonth, openingAsOf: c.openingAsOf ? c.openingAsOf.toISOString().slice(0, 10) : null, booksLockedTo: c.booksLockedTo ? c.booksLockedTo.toISOString().slice(0, 10) : null }} />
                <GuardedDelete screen="companies.list" action={deleteCompany.bind(null, c.id)} label={`Delete company ${c.code}? (only if it has no records)`} />
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Currency</dt>
                <dd className="font-medium text-ink">{c.baseCurrency}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Users</dt>
                <dd className="font-medium text-ink">{c._count.memberships}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Status</dt>
                <dd><ActiveToggle isActive={c.isActive} action={toggleCompanyActive.bind(null, c.id)} /></dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">Multi-company:</span> resources (manpower, tools,
          materials) can be shared between companies, and the system creates the matching
          inter-company charge automatically. Group reports consolidate all companies.
        </p>
      </div>
    </div>
  );
}
