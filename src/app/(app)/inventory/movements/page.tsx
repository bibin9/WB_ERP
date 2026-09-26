import Link from "next/link";
import { PackagePlus } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import MovementForm from "@/components/inventory/MovementForm";
import InspectDelivery from "@/components/inventory/InspectDelivery";
import DocumentButtons from "@/components/DocumentButtons";
import { hasStoreNote, NOTE_TITLES } from "@/lib/store-notes";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { totalsByItemAndStore, binHoldingsFor } from "@/lib/stock-totals";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { balanceOf, isInward, MOVEMENT_HELP, INSPECTION_HELP } from "@/lib/stock";
import { binLabel } from "@/lib/bins";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("inventory.movements");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const where = { companyId, ...(matchAny(term, ["reference", "kind", "notes"]) ?? {}) };
  const paging = readPaging(sp);
  const total = companyId ? await db.stockMovement.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const movements = companyId
    ? await db.stockMovement.findMany({
        where,
        include: {
          item: { select: { code: true, name: true, unitCode: true } },
          store: { select: { code: true, name: true } },
          bin: { select: { code: true, zone: true } },
          job: { select: { code: true } },
          party: { select: { name: true } },
          entry: { select: { reference: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  const items = companyId
    ? await db.item.findMany({
        where: { companyId, isActive: true, isStocked: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, unitCode: true, category: true },
      })
    : [];
  const stores = companyId
    ? await db.store.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, isDefault: true },
      })
    : [];
  const jobs = companyId
    ? await db.job.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];
  const parties = companyId
    ? await db.party.findMany({
        where: { companyId, isActive: true, type: { not: "Customer" } },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      })
    : [];

  /**
   * What is on every shelf, handed to the form so it can price and warn before
   * anything is saved. The server decides the real price when it posts; this is
   * only so nobody types a quantity that was never going to be accepted.
   */
  const balances: Record<string, { quantity: number; value: number; averageCost: number }> = {};
  /** The bins in each store, and what each holds of each item (INV-14). */
  const binsByStore: Record<string, { id: string; code: string; zone: string | null; materialType: string | null }[]> = {};
  const binHoldings: Record<string, number> = {};
  if (companyId) {
    for (const b of await db.storageBin.findMany({
      where: { store: { companyId }, isActive: true },
      orderBy: [{ zone: "asc" }, { code: "asc" }],
      select: { id: true, storeId: true, code: true, zone: true, materialType: true },
    })) {
      (binsByStore[b.storeId] ??= []).push({ id: b.id, code: b.code, zone: b.zone, materialType: b.materialType });
    }
    // Totalled by the database, rather than every movement ever recorded
    // loaded into the page and added up here.
    Object.assign(binHoldings, await binHoldingsFor(companyId));
    for (const [key, list] of await totalsByItemAndStore(companyId)) balances[key] = balanceOf(list);
  }

  const itemCategories = companyId
    ? (await db.item.groupBy({ by: ["category"], where: { companyId, category: { not: null } }, orderBy: { category: "asc" } }))
        .map((c) => c.category!)
    : [];
  const canAddItem = can(session, "inventory.items", "create");
  const canAddParty = can(session, "finance.parties", "create");
  const canAddStore = can(session, "inventory.stores", "create");

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Stock Movements" />

      <PageHeader
        title="Stores — Receive & Issue"
        subtitle="Everything that has come in or gone out, and what it did to the accounts."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && stores.length > 0 && items.length > 0 && (
            <MovementForm
              itemCategories={itemCategories}
              canAddItem={canAddItem}
              canAddParty={canAddParty}
              canAddStore={canAddStore}
              companyId={companyId}
              items={items}
              stores={stores}
              jobs={jobs}
              parties={parties}
              balances={balances}
              bins={binsByStore}
              binHoldings={binHoldings}
            />
          )}
        </div>
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker
          companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          current={companyId}
        />
      </div>

      {companyId && (items.length === 0 || stores.length === 0) && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Nothing can move yet.</span>{" "}
          {items.length === 0 && <>Add the items you buy and keep on <Link href="/inventory" className="underline">Items</Link>. </>}
          {stores.length === 0 && <>Add at least one store on <Link href="/inventory/stores" className="underline">Stores</Link>.</>}
        </div>
      )}

      <div className="mb-4">
        <SearchBox placeholder="Search reference, kind or notes" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">What happened</th>
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Store</th>
              <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
              <th className="px-4 py-2.5 text-right font-medium">Unit cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Value</th>
              <th className="px-4 py-2.5 font-medium">Job / supplier</th>
              <th className="px-4 py-2.5 font-medium">QA/QC</th>
              <th className="px-4 py-2.5 font-medium">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {movements.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term
                    ? "Nothing has moved yet. Record a delivery when material arrives."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {movements.map((m) => {
              const up = isInward(m.kind);
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmt(m.date)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      title={MOVEMENT_HELP[m.kind]}
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        up ? "bg-brand-green/10 text-brand-green-700" : "bg-brand-blue/10 text-brand-blue-600"
                      }`}
                    >
                      {m.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-heading">{m.item.code}</span>
                    <div className="text-xs text-muted">{m.item.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                    {m.store.code}
                    {m.bin && <div className="font-mono text-heading">{binLabel(m.bin)}</div>}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${up ? "text-brand-green-700" : "text-ink"}`}>
                    {up ? "+" : "−"}{m.quantity.toLocaleString()} <span className="text-xs text-muted">{m.item.unitCode}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{money(m.unitCost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(m.value)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {m.job ? m.job.code : m.party ? m.party.name : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    {m.inspection ? (
                      <div className="flex items-center gap-1.5">
                        <span
                          title={INSPECTION_HELP[m.inspection]}
                          className={`rounded px-1.5 py-0.5 ${
                            m.inspection === "Accepted"
                              ? "bg-brand-green/10 text-brand-green-700"
                              : m.inspection === "Rejected"
                                ? "bg-red-50 text-red-600"
                                : "bg-brand-gold/10 text-brand-gold"
                          }`}
                        >
                          {m.inspection}
                        </span>
                        {m.inspection === "Pending" && (
                          <InspectDelivery
                            movementId={m.id}
                            label={`${m.item.code} — ${m.item.name} on ${m.reference}`}
                            quantity={m.quantity}
                            unitCode={m.item.unitCode}
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="font-mono text-heading">{m.reference}</span>
                    {hasStoreNote(m.kind) && (
                      <div>
                        <DocumentButtons compact kind="store-note" id={m.id} label="Note" title={NOTE_TITLES[m.kind]} />
                      </div>
                    )}
                    <div className="text-muted">
                      {m.entry ? (
                        <Link href="/finance/daybook" className="hover:underline">{m.entry.reference}</Link>
                      ) : (
                        <span title="A transfer changes where stock is, not what the company owns">no voucher</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="movements" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <PackagePlus className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Material that has to pass QA/QC arrives on the shelf but is not free to use until somebody has looked at
          it, so the issue check reads what is usable rather than what is present. Material arriving is an asset, not a cost. It becomes a cost on the day it is issued to a job, which is why
          an issue has to name one. A transfer between our own stores posts nothing at all: it changes where the stock
          is, not what the company owns. Nothing here can be edited — a correction is a new movement, so the history
          still explains itself.
        </p>
      </div>
    </div>
  );
}
