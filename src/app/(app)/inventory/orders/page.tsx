import Link from "next/link";
import { FileText, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import OrderForm from "@/components/inventory/OrderForm";
import OrderActions from "@/components/inventory/OrderActions";
import Attachments from "@/components/Attachments";
import SaveAsTemplate from "@/components/inventory/SaveAsTemplate";
import { attachableFor } from "@/lib/attachments";
import DocumentButtons from "@/components/DocumentButtons";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import {
  lineProgress, orderState, summarisePurchasing, purchasingVerdict, isServiceOrder,
  PO_STATUS_HELP, RECEIVABLE,
} from "@/lib/purchasing";
import { syncOrderApproval } from "@/lib/purchase-posting";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  Draft: "bg-line text-muted",
  "Awaiting approval": "bg-brand-blue/10 text-brand-blue-600",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
  "Partly received": "bg-brand-gold/10 text-brand-gold",
  Received: "bg-brand-green/10 text-brand-green-700",
  Cancelled: "bg-line text-muted",
};

/**
 * Purchase orders (INV-05, INV-08, INV-10).
 *
 * The status on every row is refreshed from the approval it is waiting on
 * before anything is drawn, so the register and the approvals inbox cannot
 * tell different stories.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string; show?: string; from?: string }>;
}) {
  await requireAccess("inventory.orders");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const showAll = sp.show === "all";
  const where = {
    companyId,
    ...(showAll ? {} : { status: { notIn: ["Received", "Cancelled", "Rejected"] } }),
    ...(matchAny(term, ["number", "partyName", "notes"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.purchaseOrder.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const ids = companyId
    ? (await db.purchaseOrder.findMany({
        where, orderBy: { date: "desc" },
        skip: (info.page - 1) * info.perPage, take: info.perPage,
        select: { id: true },
      })).map((o) => o.id)
    : [];

  // The approval decides; the order follows. Done before reading so the page
  // never shows a status the inbox has already moved on from.
  for (const id of ids) await syncOrderApproval(id);

  const orders = ids.length
    ? await db.purchaseOrder.findMany({
        where: { id: { in: ids } },
        include: {
          lines: {
            include: { receipts: { select: { quantity: true } }, item: true },
            orderBy: { sortOrder: "asc" },
          },
          job: { select: { code: true } },
          store: { select: { code: true } },
          request: { select: { number: true } },
          invoices: { select: { id: true, number: true, grossTotal: true, status: true } },
        },
        orderBy: { date: "desc" },
      })
    : [];

  const allForTotals = companyId
    ? await db.purchaseOrder.findMany({
        where: { companyId },
        select: {
          status: true, total: true, expectedDate: true,
          lines: { select: { quantity: true, unitPrice: true, receipts: { select: { quantity: true } } } },
        },
      })
    : [];
  // The evidence filed against these orders: the supplier's bill, the receipts
  // behind it, the quote it was awarded from.
  // Orders somebody expects to raise again, for the picker at the top of the
  // form: the monthly PRO package, the consumables run, the shutdown hire.
  const templates = companyId
    ? await db.orderTemplate.findMany({
        where: { companyId },
        orderBy: { name: "asc" },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      })
    : [];
  // For the item dialog the order form can open when something is not in the
  // catalogue yet: the categories already in use, so a new item joins one of
  // them rather than inventing a spelling.
  const itemCategories = companyId
    ? (await db.item.groupBy({ by: ["category"], where: { companyId, category: { not: null } }, orderBy: { category: "asc" } }))
        .map((c) => c.category!)
    : [];
  const canAddItem = can(session, "inventory.items", "create");
  const canAddParty = can(session, "finance.parties", "create");
  const canAddStore = can(session, "inventory.stores", "create");
  const canAttach = can(session, "inventory.orders", "create");
  const canRemoveAttachment = can(session, "inventory.orders", "delete");
  const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const files = ids.length
    ? await db.attachment.findMany({ where: { entity: "PurchaseOrder", entityId: { in: ids } }, orderBy: { createdAt: "asc" } })
    : [];
  const totals = summarisePurchasing(allForTotals);
  const verdict = purchasingVerdict(allForTotals);

  const parties = companyId
    ? await db.party.findMany({
        where: { companyId, isActive: true, type: { not: "Customer" } },
        orderBy: { name: "asc" }, select: { id: true, code: true, name: true },
      })
    : [];
  const items = companyId
    ? await db.item.findMany({
        where: { companyId, isActive: true }, orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, unitCode: true, standardCost: true, isStocked: true },
      })
    : [];
  const jobs = companyId
    ? await db.job.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })
    : [];
  const stores = companyId
    ? await db.store.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, isDefault: true } })
    : [];

  /**
   * The bins in each store (INV-14).
   *
   * A binned store refuses a movement that does not name a bin, and the main
   * store is both the store most likely to be binned and the store orders are
   * received into — so without these the delivery was refused at the counter
   * with nothing on the screen that could answer it.
   */
  const binsByStore: Record<string, { id: string; code: string; zone: string | null; materialType: string | null }[]> = {};
  if (companyId) {
    for (const b of await db.storageBin.findMany({
      where: { store: { companyId }, isActive: true },
      orderBy: [{ zone: "asc" }, { code: "asc" }],
      select: { id: true, storeId: true, code: true, zone: true, materialType: true },
    })) {
      (binsByStore[b.storeId] ??= []).push({ id: b.id, code: b.code, zone: b.zone, materialType: b.materialType });
    }
  }

  // Arriving from an approved material request, its lines prefill the order.
  const fromRequest = sp.from
    ? await db.materialRequest.findFirst({
        where: { id: sp.from, companyId, status: "Approved" },
        include: { lines: { include: { item: true }, orderBy: { order: "asc" } } },
      })
    : null;

  const card = "card p-5";

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Purchase Orders" />

      <PageHeader
        title="Stores — Purchase Orders"
        subtitle="What has been committed to suppliers, and how much of it has turned up."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && parties.length > 0 && (
            <OrderForm
              companyId={companyId}
              parties={parties}
              items={items}
              jobs={jobs}
              stores={stores}
              itemCategories={itemCategories}
              canAddItem={canAddItem}
              canAddParty={canAddParty}
              canAddStore={canAddStore}
              templates={templates.map((t) => ({
                id: t.id, name: t.name, partyId: t.partyId, notes: t.notes,
                lines: t.lines.map((l) => ({ itemId: l.itemId, description: l.description, unitCode: l.unitCode, quantity: l.quantity, unitPrice: l.unitPrice })),
              }))}
              fromRequest={
                fromRequest
                  ? {
                      id: fromRequest.id,
                      number: fromRequest.number,
                      jobId: fromRequest.jobId,
                      storeId: fromRequest.storeId,
                      lines: fromRequest.lines.map((l) => ({
                        itemId: l.itemId,
                        description: l.item ? `${l.item.code} — ${l.item.name}` : l.description,
                        unitCode: l.unitCode,
                        quantity: l.quantity,
                        unitPrice: l.item?.standardCost ?? 0,
                      })),
                    }
                  : null
              }
            />
          )}
        </div>
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <p className="mb-5 text-sm text-ink">{verdict}</p>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${card} ${totals.awaitingApproval > 0 ? "border-brand-blue/40" : ""}`}>
          <div className="text-sm text-muted">Waiting for approval</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.awaitingApproval}</div>
          <div className="mt-0.5 text-xs text-muted">nothing can be received against these</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Committed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.committed)}</div>
          <div className="mt-0.5 text-xs text-muted">across {totals.open} open order{totals.open === 1 ? "" : "s"}</div>
        </div>
        <div className={card}>
          <div className="text-sm text-muted">Still to arrive</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{money(totals.outstandingValue)}</div>
          <div className="mt-0.5 text-xs text-muted">ordered and not delivered</div>
        </div>
        <div className={`${card} ${totals.overdue > 0 ? "border-brand-gold/40" : ""}`}>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            {totals.overdue > 0 && <AlertTriangle className="h-4 w-4 text-brand-gold" />}
            Past the promised date
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-heading">{totals.overdue}</div>
          <div className="mt-0.5 text-xs text-muted">supplier is late</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search number, supplier or notes" />
        <div className="flex items-center gap-2 text-sm">
          <a href={`/inventory/orders?c=${companyId}`} className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>Live</a>
          <span className="text-line">|</span>
          <a href={`/inventory/orders?c=${companyId}&show=all`} className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>All</a>
        </div>
      </div>

      <div className="space-y-4">
        {orders.length === 0 && (
          <div className="card px-4 py-10 text-center text-muted">
            {total === 0 && !term
              ? "No purchase orders yet. Raise one when material needs ordering."
              : "Nothing matches."}
          </div>
        )}

        {orders.map((o) => {
          const s = orderState({ status: o.status, total: o.total, expectedDate: o.expectedDate, lines: o.lines });
          return (
            <div key={o.id} className={`card p-5 ${s.overdue ? "border-brand-gold/40" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-heading">{o.number}</span>
                    <span
                      title={PO_STATUS_HELP[o.status]}
                      className={`rounded px-1.5 py-0.5 text-xs ${statusColour[o.status] ?? "bg-line text-muted"}`}
                    >
                      {o.status}
                    </span>
                    {s.overdue && (
                      <span className="rounded bg-brand-gold/10 px-1.5 py-0.5 text-xs text-brand-gold">
                        {s.daysLate} day{s.daysLate === 1 ? "" : "s"} late
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-ink">{o.partyName}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fmt(o.date)}
                    {o.expectedDate && <> · promised {fmt(o.expectedDate)}</>}
                    {o.job && <> · {o.job.code}</>}
                    {o.store && <> · to {o.store.code}</>}
                    {o.request && <> · from {o.request.number}</>}
                    {" · raised by "}{o.raisedBy}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums text-heading">{money(o.total)}</div>
                  <div className="text-xs text-muted">{money(s.outstandingValue)} still to arrive</div>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2 pr-4 font-medium">What</th>
                      <th className="py-2 pr-4 text-right font-medium">Ordered</th>
                      <th className="py-2 pr-4 text-right font-medium">Arrived</th>
                      <th className="py-2 pr-4 text-right font-medium">Outstanding</th>
                      <th className="py-2 pr-4 text-right font-medium">Price</th>
                      <th className="py-2 pr-4 text-right font-medium">Value</th>
                      <th className="py-2 font-medium print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {o.lines.map((l) => {
                      const p = lineProgress(l.quantity, l.receipts);
                      return (
                        <tr key={l.id}>
                          <td className="py-2 pr-4 text-ink">{l.description}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-ink">
                            {p.ordered.toLocaleString()} <span className="text-xs text-muted">{l.unitCode}</span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted">
                            {p.received > 0 ? p.received.toLocaleString() : "—"}
                          </td>
                          <td className={`py-2 pr-4 text-right tabular-nums ${p.complete ? "text-brand-green-700" : "text-ink"}`}>
                            {p.complete ? "complete" : p.outstanding.toLocaleString()}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-muted">{money(l.unitPrice)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-ink">{money(l.netAmount)}</td>
                          <td className="py-2 text-right print:hidden">
                            {RECEIVABLE.has(o.status) && !p.complete && l.itemId && (
                              <OrderActions
                                mode="receive"
                                orderLineId={l.id}
                                label={l.description}
                                outstanding={p.outstanding}
                                unitCode={l.unitCode}
                                stores={stores}
                                bins={binsByStore}
                                defaultStoreId={o.storeId ?? stores.find((x) => x.isDefault)?.id ?? ""}
                              />
                            )}
                            {RECEIVABLE.has(o.status) && !p.complete && !l.itemId && (
                              <span className="text-xs text-muted" title="Add it as an item first, or charge it to the job on the supplier invoice">
                                not a stock item
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {o.notes && <p className="mt-3 text-xs text-muted">{o.notes}</p>}

              {o.invoices.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Billed against this order:{" "}
                  {o.invoices.map((i, n) => (
                    <span key={i.id}>
                      {n > 0 && ", "}
                      <Link href="/finance/invoices" className="text-brand-blue-600 hover:underline">{i.number}</Link>{" "}
                      {money(i.grossTotal)}{i.status === "Draft" ? " (draft)" : ""}
                    </span>
                  ))}
                </p>
              )}

              <div className="mt-3">
                <Attachments
                  entity="PurchaseOrder"
                  entityId={o.id}
                  kinds={attachableFor("PurchaseOrder")!.kinds}
                  rows={files.filter((f) => f.entityId === o.id).map((f) => ({
                    id: f.id, kind: f.kind, fileName: f.fileName, size: f.size,
                    uploadedBy: f.uploadedBy, createdAt: fmtDate(f.createdAt),
                  }))}
                  canAdd={canAttach}
                  canRemove={canRemoveAttachment && o.status === "Draft"}
                  note="The supplier's invoice and the receipts behind it, a quotation, an approval by email. Whoever approves this order sees them with it."
                />
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2 print:hidden">
                <DocumentButtons kind="purchase-order" id={o.id} />
                {canAttach && <SaveAsTemplate orderId={o.id} suggestion={`${o.partyName} — ${o.lines[0]?.description ?? "order"}`.slice(0, 60)} />}
                {o.status === "Draft" && <OrderActions mode="submit" orderId={o.id} label={o.number} />}
                {/* Services never arrive in a store, so this is the only way
                    such an order can be closed (lib/purchasing.ts). */}
                {["Approved", "Partly received"].includes(o.status) && isServiceOrder(o.lines) && (
                  <OrderActions mode="deliver" orderId={o.id} label={o.number} />
                )}
                {!["Received", "Cancelled", "Rejected"].includes(o.status) && (
                  <OrderActions mode="cancel" orderId={o.id} label={o.number} />
                )}
                {o.status === "Awaiting approval" && (
                  <Link href="/approvals" className="btn-ghost">See it in Approvals</Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Pager info={info} label="orders" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <FileText className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          An order posts nothing to the accounts. It is a commitment to buy, and until material arrives nothing has
          been delivered and nothing is owed. Nothing can be received against an order until it has been approved,
          and how much has arrived is added up from the deliveries rather than typed, so an order cannot claim to be
          complete when it is not. There is no VAT on an order: the tax point is the supplier&rsquo;s invoice.
        </p>
      </div>
    </div>
  );
}
