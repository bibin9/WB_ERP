import Link from "next/link";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GuardedDelete from "@/components/GuardedDelete";
import CustomFieldAdmin from "@/components/customfields/CustomFieldAdmin";
import { deleteCustomField } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CustomFieldsPage() {
  await requireAccess("settings.custom");
  const session = await getSession();
  if (!session) return null;
  const fields = await db.customFieldDef.findMany({ where: { tenantId: session.tenant.id, entity: "Employee" }, orderBy: { order: "asc" } });

  return (
    <div>
      <PageHeader title="Custom Employee Fields" subtitle="Define your own fields for employee profiles. They appear on every employee's profile — no code needed." />
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to Settings</Link>

      <div className="mb-4"><CustomFieldAdmin /></div>

      <div className="card">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-heading">
          <SlidersHorizontal className="h-4 w-4" /> <h2 className="font-semibold">Defined fields</h2>
          <span className="ml-auto text-xs text-muted">{fields.length}</span>
        </div>
        <div className="divide-y divide-line">
          {fields.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No custom fields yet. Add one above.</p>}
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex-1 text-sm font-medium text-ink">{f.label}</span>
              <span className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs text-heading">{f.type}</span>
              {f.options && <span className="text-xs text-muted">{f.options}</span>}
              <GuardedDelete screen="settings.custom" action={deleteCustomField.bind(null, f.id)} label={`Delete custom field "${f.label}"? (removes its values)`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
