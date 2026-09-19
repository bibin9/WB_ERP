import { Warehouse } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import GuardedDelete from "@/components/GuardedDelete";
import StoreForm from "@/components/inventory/StoreForm";
import BinForm from "@/components/inventory/BinForm";
import { deleteStore, deleteBin } from "../actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { balanceOf } from "@/lib/stock";
import { totalsByStore } from "@/lib/stock-totals";
import { binLabel, binQuantities, binVerdict } from "@/lib/bins";

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
          bins: { orderBy: [{ zone: "asc" }, { code: "asc" }] },
        },
        orderBy: { code: "asc" },
      })
    : [];
  // Totalled by the database per store and bin, not every movement loaded.
  const totals = companyId ? await totalsByStore(companyId) : new Map();

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
              <th className="px-4 py-2.5 font-medium">Kind</th>
              <th className="px-4 py-2.5 font-medium">Where</th>
              <th className="px-4 py-2.5 font-medium">Zones &amp; bins</th>
              <th className="px-4 py-2.5 text-right font-medium">Value held</th>
              <th className="px-4 py-2.5 text-right font-medium">Movements</th>
              <th className="px-4 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stores.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  No stores yet. Add at least one before anything can be received.
                </td>
              </tr>
            )}
            {stores.map((s) => {
              const t = totals.get(s.id) ?? { groups: [], count: 0 };
              const held = balanceOf(t.groups);
              const perBin = binQuantities(t.groups);
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
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{s.kind}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{s.location ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {s.bins.length === 0 ? (
                      <span className="text-muted">Not divided into bins</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {s.bins.map((b) => (
                          <span
                            key={b.id}
                            title={
                              [b.name, b.materialType ? `meant for ${b.materialType}` : null]
                                .filter(Boolean).join(" · ") || undefined
                            }
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                              !b.isActive
                                ? "bg-line text-muted/60 line-through"
                                : (perBin[b.id] ?? 0) > 0
                                  ? "bg-brand-green/10 text-brand-green-700"
                                  : "bg-line text-muted"
                            }`}
                          >
                            <span className="font-mono">{binLabel(b)}</span>
                            <span className="flex items-center print:hidden">
                              <BinForm
                                storeId={s.id}
                                storeCode={s.code}
                                row={{
                                  id: b.id, code: b.code, zone: b.zone, name: b.name,
                                  materialType: b.materialType, notes: b.notes, isActive: b.isActive,
                                }}
                              />
                              <GuardedDelete
                                screen="inventory.stores"
                                action={deleteBin.bind(null, b.id)}
                                label={`Remove bin ${binLabel(b)} from ${s.code}?`}
                              />
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 print:hidden">
                      <BinForm storeId={s.id} storeCode={s.code} isFirst={s.bins.length === 0} />
                    </div>
                    <div className="mt-1 text-muted">{binVerdict(s.bins, perBin)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(held.value)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{t.count || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right print:hidden">
                    <div className="flex items-center justify-end gap-1">
                      <StoreForm
                        companyId={companyId}
                        row={{
                          id: s.id, code: s.code, name: s.name,
                          location: s.location, kind: s.kind, isDefault: s.isDefault, isActive: s.isActive,
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
          Bins are optional and adopted a store at a time: a store with none carries on exactly as before, and a
          store that has them requires one on every movement, because half-binned stock stops the bin totals
          agreeing with the shelf. A bin answers which rack to walk to, never what the stock is worth — valuation
          stays per store whatever the layout.
        </p>
      </div>
    </div>
  );
}
