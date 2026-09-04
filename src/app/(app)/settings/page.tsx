import Link from "next/link";
import { Palette, Building2, Users, SlidersHorizontal, GitBranch, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { requireAccess } from "@/lib/guard";
import { activeTenant } from "@/config/tenant";

export const dynamic = "force-dynamic";

function Swatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-8 w-8 rounded-lg border border-line"
        style={{ background: `rgb(var(${varName}))` }}
      />
      <div className="text-xs">
        <div className="font-medium text-ink">{label}</div>
        <div className="text-muted">{varName}</div>
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  await requireAccess("settings.general");
  const t = activeTenant;
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Product configuration. The branding below is white-label — one config re-skins the whole app for any customer."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-heading">
            <Palette className="h-5 w-5" />
            <h2 className="font-semibold">Brand & Theme</h2>
          </div>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.logo} alt={t.productName} className="h-12 w-auto" />
            <div>
              <div className="font-medium text-ink">{t.productName}</div>
              <div className="text-xs text-muted">Tenant: {t.key}</div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Swatch label="Primary (navy)" varName="--brand-navy" />
            <Swatch label="Accent (blue)" varName="--brand-blue" />
            <Swatch label="Action (green)" varName="--brand-green" />
            <Swatch label="Warning (gold)" varName="--brand-gold" />
          </div>
          <p className="mt-4 rounded-lg bg-brand-blue/5 p-3 text-xs text-muted">
            To resell this ERP to another company, change <code className="text-ink">src/config/tenant.ts</code>{" "}
            (name, colours, logo, companies) — no code changes needed.
          </p>
        </div>

        <div className="space-y-4">
          <div className="card flex items-center gap-3 p-5">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-navy/10 text-heading">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <div className="font-medium text-ink">Companies</div>
              <div className="text-xs text-muted">{t.companies.length} group companies configured</div>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-5">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-green/10 text-brand-green">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <div className="font-medium text-ink">Users & Roles</div>
              <div className="text-xs text-muted">Role-based access control (Phase 1)</div>
            </div>
          </div>
          <Link href="/settings/custom-fields" className="card flex items-center gap-3 p-5 hover:border-brand-blue">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-blue/10 text-brand-blue-600">
              <SlidersHorizontal className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="font-medium text-ink">Custom Employee Fields</div>
              <div className="text-xs text-muted">Add your own fields to employee profiles</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted" />
          </Link>
          <Link href="/settings/approvals" className="card flex items-center gap-3 p-5 hover:border-brand-blue">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gold/15 text-brand-gold">
              <GitBranch className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="font-medium text-ink">Approval Routes</div>
              <div className="text-xs text-muted">Configure sign-off chains per document type</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted" />
          </Link>
        </div>
      </div>
    </div>
  );
}
