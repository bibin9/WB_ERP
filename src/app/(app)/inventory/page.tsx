import { Package } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import GuardedDelete from "@/components/GuardedDelete";
import ItemForm from "@/components/inventory/ItemForm";
import { deleteItem } from "./actions";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string; show?: string }>;
}) {
  await requireAccess("inventory.items");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const term = readSearch(sp);
  const showAll = sp.show === "all";
  const where = {
    companyId,
    ...(showAll ? {} : { isActive: true }),
    ...(matchAny(term, ["code", "name", "category", "description"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.item.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const items = companyId
    ? await db.item.findMany({
        where,
        include: { _count: { select: { movements: true } } },
        orderBy: { code: "asc" },
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  // Offered back on the form so categories converge rather than multiply.
  const categoryRows = companyId
    ? await db.item.groupBy({ by: ["category"], where: { companyId }, orderBy: { category: "asc" } })
    : [];
  const categories = categoryRows.map((r) => r.category).filter((c): c is string => !!c);

  return (
    <div>
      <PageHeader title="Stores — Items" subtitle="Everything you buy and keep, and the units it is measured in.">
        {companyId && <ItemForm companyId={companyId} categories={categories} />}
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search code, name or category" />
        <div className="flex items-center gap-2 text-sm">
          <a href={`/inventory?c=${companyId}`} className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>
            In use
          </a>
          <span className="text-line">|</span>
          <a href={`/inventory?c=${companyId}&show=all`} className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>
            All
          </a>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium">Unit</th>
              <th className="px-4 py-2.5 font-medium">Stocked</th>
              <th className="px-4 py-2.5 text-right font-medium">Reorder at</th>
              <th className="px-4 py-2.5 text-right font-medium">Standard cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Movements</th>
              <th className="px-4 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term
                    ? "No items yet. Add the things you buy and keep in the store."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.id} className={i.isActive ? "" : "opacity-60"}>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{i.code}</td>
                <td className="px-4 py-2.5 text-ink">
                  {i.name}
                  {i.description && <div className="text-xs text-muted">{i.description}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted">{i.category ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{i.unitCode}</td>
                <td className="px-4 py-2.5">
                  {i.isStocked ? (
                    <span className="rounded bg-brand-green/10 px-1.5 py-0.5 text-xs text-brand-green-700">on a shelf</span>
                  ) : (
                    <span
                      className="rounded bg-line px-1.5 py-0.5 text-xs text-muted"
                      title="Bought and used the same day. Charged straight to the job on a supplier invoice."
                    >
                      straight to cost
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {i.isStocked && i.reorderLevel > 0 ? i.reorderLevel.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {i.standardCost > 0 ? money(i.standardCost) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{i._count.movements || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right print:hidden">
                  <div className="flex items-center justify-end gap-1">
                    <ItemForm
                      companyId={companyId}
                      categories={categories}
                      row={{
                        id: i.id, code: i.code, name: i.name, description: i.description,
                        category: i.category, unitCode: i.unitCode, isStocked: i.isStocked,
                        reorderLevel: i.reorderLevel, standardCost: i.standardCost, isActive: i.isActive,
                      }}
                    />
                    <GuardedDelete
                      screen="inventory.items"
                      action={deleteItem.bind(null, i.id)}
                      label={`Remove ${i.code} — ${i.name}?`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="items" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Package className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Not everything you buy is stocked. Hire, a service, or a one-off bought and used the same day never sits on
          a shelf, so it is marked as going straight to cost and is charged to the job on the supplier invoice
          instead. An item that already has movements behind it cannot be deleted or switched to non-stocked, because
          its history would stop making sense.
        </p>
      </div>
    </div>
  );
}
