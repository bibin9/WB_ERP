import { Boxes, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readSearch } from "@/lib/search";
import { balanceOf, needsReorder, summariseStock, stockVerdict } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * What is on the shelf, and what it is worth.
 *
 * Every figure is summed from the movements rather than read from a stored
 * balance, so the report and its own history can never disagree.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; store?: string; show?: string }>;
}) {
  await requireAccess("inventory.stock");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const storeFilter = String(sp.store ?? "");
  const showAll = sp.show === "all";

  const stores = companyId
    ? await db.store.findMany({ where: { companyId }, orderBy: { code: "asc" } })
    : [];

  const items = companyId
    ? await db.item.findMany({
        where: {
          companyId,
          isStocked: true,
          ...(term
            ? { OR: [{ code: { contains: term } }, { name: { contains: term } }, { category: { contains: term } }] }
            : {}),
        },
        include: {
          movements: {
            where: storeFilter ? { storeId: storeFilter } : {},
            select: { kind: true, quantity: true, value: true, inspection: true },
          },
        },
        orderBy: { code: "asc" },
      })
    : [];

  const rows = items.map((i) => ({
    itemId: i.id,
    code: i.code,
    name: i.name,
    category: i.category,
    unitCode: i.unitCode,
    reorderLevel: i.reorderLevel,
    balance: balanceOf(i.movements),
  }));

  // Items that have never moved crowd out the ones that have. They are still
  // reachable, just not in the way by default.
  const shown = showAll ? rows : rows.filter((r) => r.balance.quantity !== 0);
  const totals = summariseStock(rows);
  const verdict = stockVerdict(rows);
  const card = "card p-5";

  return (
    <div>
      <PrintHeader
        companyName={companyName}
        logoUrl={company?.logoUrl}
        title="Stock on Hand"
        subtitle={storeFilter ? stores.find((s) => s.id === storeFilter)?.name ?? "" : "all stores"}
      />

      <PageHeader title="Stores — Stock on Hand" subtitle="What is on the shelf, and what it is worth.">
        <PrintReport />
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      <p className="mb-5 text-sm text-ink">{verdict}</p>

      {totals.negative > 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {totals.negative === 1 ? "One item shows" : `${totals.negative} items show`} less than nothing in stock.
          </span>{" "}
          Something left a shelf it was never on. Count it and put the difference through as an adjustment before
          trusting any figure on this page.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={card}>
          <div className="text-sm text-muted">Stock value</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.value)}</div>
          <div className="mt-0.5 text-xs text-muted">
            across {totals.stocked} {totals.stocked === 1 ? "item" : "items"}
          </div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Items set up</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.items}</div>
          <div className="mt-0.5 text-xs text-muted">{totals.items - totals.stocked} with nothing on hand</div>
        </div>
        <div className={`${card} ${totals.belowReorder > 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {totals.belowReorder > 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Need reordering
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.belowReorder}</div>
          <div className="mt-0.5 text-xs text-muted">at or below their level</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Stores</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{stores.length}</div>
          <div className="mt-0.5 text-xs text-muted">
            {storeFilter ? "showing one" : "showing all together"}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search code, name or category" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <a
              href={`/inventory/stock?c=${companyId}${showAll ? "&show=all" : ""}`}
              className={!storeFilter ? "font-medium text-ink" : "text-muted hover:text-ink"}
            >
              All stores
            </a>
            {stores.map((s) => (
              <a
                key={s.id}
                href={`/inventory/stock?c=${companyId}&store=${s.id}${showAll ? "&show=all" : ""}`}
                className={storeFilter === s.id ? "font-medium text-ink" : "text-muted hover:text-ink"}
              >
                {s.code}
              </a>
            ))}
          </div>
          <span className="text-line">|</span>
          <a
            href={`/inventory/stock?c=${companyId}${storeFilter ? `&store=${storeFilter}` : ""}${showAll ? "" : "&show=all"}`}
            className="text-muted hover:text-ink"
          >
            {showAll ? "Hide empty" : "Show empty"}
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
              <th className="px-4 py-2.5 text-right font-medium">On hand</th>
              <th className="px-4 py-2.5 text-right font-medium">Free to issue</th>
              <th className="px-4 py-2.5 font-medium">Unit</th>
              <th className="px-4 py-2.5 text-right font-medium">Average cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Value</th>
              <th className="px-4 py-2.5 text-right font-medium">Reorder at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {rows.length === 0
                    ? "No stocked items yet. Add what you buy and keep, then record what arrives."
                    : "Nothing on any shelf. Show empty to see the items that are set up."}
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const low = needsReorder(r);
              const negative = r.balance.quantity < 0;
              return (
                <tr key={r.itemId} className={negative ? "bg-brand-gold/5" : ""}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-heading">{r.code}</td>
                  <td className="px-4 py-2.5 text-ink">{r.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{r.category ?? "—"}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                      negative ? "text-brand-gold" : low ? "text-brand-gold" : "text-ink"
                    }`}
                  >
                    {r.balance.quantity.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.balance.usable === r.balance.quantity ? (
                      <span className="text-muted">all of it</span>
                    ) : (
                      <span
                        className="font-medium text-brand-gold"
                        title={`${r.balance.awaitingInspection.toLocaleString()} waiting on QA/QC, ${r.balance.rejected.toLocaleString()} rejected`}
                      >
                        {r.balance.usable.toLocaleString()}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{r.unitCode}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {r.balance.quantity > 0 ? money(r.balance.averageCost) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(r.balance.value)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {r.reorderLevel > 0 ? r.reorderLevel.toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Boxes className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Stock is valued at weighted average: cable bought at three prices is the same cable on the drum. Receiving
          moves the average, issuing does not. Every figure here is summed from the movements themselves rather than
          read from a stored balance, so this report and its own history can never disagree.
        </p>
      </div>
    </div>
  );
}
