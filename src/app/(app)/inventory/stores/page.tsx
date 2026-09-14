import { Warehouse } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import GuardedDelete from "@/components/GuardedDelete";
import StoreForm from "@/components/inventory/StoreForm";
import { deleteStore } from "../actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { balanceOf } from "@/lib/stock";

export const dynamic = "force-dynamic";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("inventory.stores");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const stores = companyId
    ? await db.store.findMany({
        where: { companyId },
        include: {
          movements: { select: { kind: true, quantity: true, value: true } },
          _count: { select: { movements: true } },
        },
        orderBy: { code: "asc" },
      })
    : [];

  return (
    <div>
      <PageHeader title="Stores" subtitle="Where stock sits. A main store, a site container, a van.">
        {companyId && <StoreForm companyId={companyId} />}
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Store</th>
              <th className="px-4 py-2.5 font-medium">Where</th>
              <th className="px-4 py-2.5 text-right font-medium">Value held</th>
              <th className="px-4 py-2.5 text-right font-medium">Movements</th>
              <th className="px-4 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stores.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No stores yet. Add at least one before anything can be received.
                </td>
              </tr>
            )}
            {stores.map((s) => {
              const held = balanceOf(s.movements);
              return (
                <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{s.code}</td>
                  <td className="px-4 py-2.5 text-ink">
                    {s.name}
                    {s.isDefault && (
                      <span className="ml-2 rounded bg-brand-blue/10 px-1.5 py-0.5 text-xs text-brand-blue-600">
                        default
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{s.location ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(held.value)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{s._count.movements || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      <StoreForm
                        companyId={companyId}
                        row={{
                          id: s.id, code: s.code, name: s.name,
                          location: s.location, isDefault: s.isDefault, isActive: s.isActive,
                        }}
                      />
                      <GuardedDelete screen="inventory.stores" action={deleteStore.bind(null, s.id)} label={`Remove ${s.code} — ${s.name}?`} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Warehouse className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          A store is separate from a job on purpose. Material can sit in a site container for weeks before it is
          issued to the work, and until it is issued it is still the company&rsquo;s stock rather than that
          contract&rsquo;s cost. Moving stock between two of your own stores posts nothing to the accounts.
        </p>
      </div>
    </div>
  );
}
