import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GuardedDelete from "@/components/GuardedDelete";
import AddItemForm from "@/components/masterdata/AddItemForm";
import { deleteMasterItem } from "./actions";
import { MASTER_TYPES } from "@/lib/master";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MasterDataPage() {
  await requireAccess("settings.master");
  const session = await getSession();
  if (!session) return null;
  const items = await db.masterItem.findMany({ where: { tenantId: session.tenant.id }, orderBy: [{ type: "asc" }, { order: "asc" }] });
  const byType = (t: string) => items.filter((i) => i.type === t);

  return (
    <div>
      <PageHeader title="Master Data" subtitle="Manage the standard lists used across the app — these drive dropdowns like department, designation and grade." />
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to Settings</Link>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MASTER_TYPES.map((type) => (
          <div key={type} className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold text-heading">{type}</h2>
              <span className="text-xs text-muted">{byType(type).length}</span>
            </div>
            <div className="max-h-64 divide-y divide-line overflow-y-auto">
              {byType(type).length === 0 && <p className="px-5 py-4 text-sm text-muted">No items.</p>}
              {byType(type).map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-5 py-1.5">
                  <span className="flex-1 text-sm text-ink">{i.value}</span>
                  <GuardedDelete screen="settings.master" action={deleteMasterItem.bind(null, i.id)} label={`Delete "${i.value}"?`} />
                </div>
              ))}
            </div>
            <div className="border-t border-line"><AddItemForm type={type} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
