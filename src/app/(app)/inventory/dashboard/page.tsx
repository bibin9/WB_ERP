import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import { Tile, Tiles, Section, Sections, Figure, Figures, Line, List, Bars, NothingToShow, aed, aedShort, plural, daysFrom, dueText } from "@/components/dashboards/Kit";
import { companyScope } from "@/lib/company-scope";
import { requireAccess } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { balanceOf, direction } from "@/lib/stock";
import { summariseCalibration } from "@/lib/calibration";

export const dynamic = "force-dynamic";

/**
 * Stores and purchasing at a glance: what the stock is worth and where, what
 * is running low, what has been asked for, ordered and not yet arrived, and
 * which instruments may not be used. Prices and supplier figures appear only
 * to those who can open the screens that hold them.
 */
export default async function InventoryDashboard({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireAccess("inventory");
  const scoped = companyScope(session.companies, (await searchParams).c);
  const ids = scoped.ids;
  const inScope = { companyId: { in: ids } };

  const g = {
    stock: can(session, "inventory.stock"),
    movements: can(session, "inventory.movements"),
    requests: can(session, "inventory.requests"),
    rfq: can(session, "inventory.rfq"),
    orders: can(session, "inventory.orders"),
    equipment: can(session, "inventory.equipment"),
    returns: can(session, "inventory.returns"),
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [byStore, stores, reorderItems, monthMoves, awaitingInspection, requests, rfqs, orders, equipment, returns] = await Promise.all([
    g.stock ? db.stockMovement.groupBy({ by: ["storeId", "kind"], where: inScope, _sum: { value: true } }) : null,
    g.stock ? db.store.findMany({ where: inScope, select: { id: true, code: true, name: true } }) : null,
    g.stock ? db.item.findMany({ where: { ...inScope, isActive: true, isStocked: true, reorderLevel: { gt: 0 } }, select: { id: true, code: true, name: true, unitCode: true, reorderLevel: true } }) : null,
    g.movements ? db.stockMovement.groupBy({ by: ["kind"], where: { ...inScope, date: { gte: monthStart } }, _count: true, _sum: { value: true } }) : null,
    g.movements ? db.stockMovement.count({ where: { ...inScope, inspection: "Pending" } }) : null,
    g.requests
      ? db.materialRequest.findMany({ where: { ...inScope, status: "Submitted" }, orderBy: { neededBy: "asc" }, select: { id: true, number: true, neededBy: true, requestedBy: true } })
      : null,
    g.rfq ? db.rfq.groupBy({ by: ["status"], where: { ...inScope, status: { in: ["Sent", "Quoted"] } }, _count: true }) : null,
    g.orders
      ? db.purchaseOrder.findMany({
          where: { ...inScope, status: { in: ["Awaiting approval", "Approved", "Partly received"] } },
          orderBy: { expectedDate: "asc" },
          select: { id: true, number: true, status: true, partyName: true, total: true, expectedDate: true },
        })
      : null,
    g.equipment
      ? db.equipment.findMany({
          where: { ...inScope, isActive: true },
          select: { id: true, serialNo: true, description: true, status: true, requiresCalibration: true, calibrations: { orderBy: { calibratedOn: "desc" }, take: 1, select: { result: true, validTo: true, calibratedOn: true } } },
        })
      : null,
    g.returns ? db.materialReturn.count({ where: { ...inScope, status: "Draft" } }) : null,
  ]);

  // Stock value by store: receipts in less issues out, as the database totals them.
  let stockValue = 0;
  const storeRows = (stores ?? []).map((s) => {
    const value = (byStore ?? []).filter((r) => r.storeId === s.id).reduce((t, r) => t + direction(r.kind) * (r._sum.value ?? 0), 0);
    stockValue += value;
    return { label: `${s.code} · ${s.name}`, value };
  }).filter((r) => Math.round(r.value) !== 0).sort((a, b) => b.value - a.value);

  // Items at or below their reorder level — only the items that have one set.
  const reorderTotals = reorderItems?.length
    ? await db.stockMovement.groupBy({ by: ["itemId", "kind", "inspection"], where: { itemId: { in: reorderItems.map((i) => i.id) } }, _sum: { quantity: true, value: true } })
    : [];
  const low = (reorderItems ?? []).map((i) => {
    const b = balanceOf(reorderTotals.filter((t) => t.itemId === i.id).map((t) => ({ kind: t.kind, inspection: t.inspection, quantity: t._sum.quantity ?? 0, value: t._sum.value ?? 0 })));
    return { ...i, onHand: b.quantity };
  }).filter((i) => i.onHand <= i.reorderLevel).sort((a, b) => a.onHand / a.reorderLevel - b.onHand / b.reorderLevel);

  const moved = (kind: string) => monthMoves?.find((m) => m.kind === kind);
  const toApprove = orders?.filter((o) => o.status === "Awaiting approval") ?? [];
  const toReceive = orders?.filter((o) => o.status !== "Awaiting approval") ?? [];
  const late = toReceive.filter((o) => o.expectedDate && o.expectedDate < today);
  const cal = equipment ? summariseCalibration(equipment.map((e) => ({ ...e, latest: e.calibrations[0] ?? null })), now) : null;
  const rfqCount = (s: string) => rfqs?.find((r) => r.status === s)?._count ?? 0;

  const anything = Object.values(g).some(Boolean);

  return (
    <div>
      <PageHeader title="Stores Dashboard" subtitle="What the stock is worth, what is running low, what is on order, and which instruments may not be used." />
      <div className="mb-5"><CompanyPicker companies={session.companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={scoped.current} allowAll label="Figures for:" /></div>
      <InventoryTabs />

      {!anything && <NothingToShow />}

      <Tiles>
        {g.stock && <Tile label="Stock value" value={aedShort(stockValue)} hint="Everything on the shelves, at average cost" href="/inventory/stock" />}
        {g.stock && <Tile label="Running low" value={String(low.length)} hint="Items at or below their reorder level" tone={low.length ? "warn" : "good"} href="/inventory/stock" />}
        {requests && <Tile label="Requests to order" value={String(requests.length)} hint="Material requests submitted and not yet ordered" tone={requests.length ? "warn" : "neutral"} href="/inventory/requests" />}
        {orders && <Tile label="Orders to receive" value={String(toReceive.length)} hint={late.length ? `${late.length} past the expected date` : "Approved orders still arriving"} tone={late.length ? "bad" : "neutral"} href="/inventory/orders" />}
        {cal && cal.equipment > 0 && <Tile label="Instruments not usable" value={String(cal.blocked)} hint={cal.expired ? `${cal.expired} out of calibration` : `${cal.expiringSoon} due for calibration within 30 days`} tone={cal.expired ? "bad" : cal.expiringSoon ? "warn" : "good"} href="/inventory/equipment" />}
      </Tiles>

      <Sections>
        {g.stock && (
          <Section title="Running low" hint="Lowest against its reorder level first." href="/inventory/stock">
            <List
              empty={reorderItems?.length ? "Nothing is at or below its reorder level." : "No item has a reorder level set yet — set one on the item to be warned here."}
              rows={low.slice(0, 6).map((i) => ({ key: i.id, href: "/inventory/stock", label: `${i.code} · ${i.name}`, right: `${i.onHand.toLocaleString()} / ${i.reorderLevel.toLocaleString()} ${i.unitCode}`, tone: i.onHand <= 0 ? "bad" : "warn" }))}
            />
          </Section>
        )}

        {g.stock && storeRows.length > 0 && (
          <Section title="Stock value by store" hint="Where the money on the shelves sits." href="/inventory/stores">
            <Bars rows={storeRows} format={aedShort} />
          </Section>
        )}

        {requests && (
          <Section title="Material requests waiting" hint="Submitted from site; the soonest needed first." href="/inventory/requests">
            <List
              empty="No submitted requests are waiting to be ordered."
              rows={requests.slice(0, 6).map((r) => {
                const d = r.neededBy ? daysFrom(r.neededBy, today) : null;
                return { key: r.id, href: "/inventory/requests", label: `${r.number} · ${r.requestedBy}`, right: d === null ? "no date" : `needed ${dueText(d)}`, tone: d !== null && d < 0 ? "bad" : d !== null && d <= 3 ? "warn" : "neutral" };
              })}
            />
            {rfqs && <Line label="Enquiries out with suppliers" value={String(rfqCount("Sent"))} href="/inventory/rfq" />}
            {rfqs && <Line label="Quotes in, to award" value={String(rfqCount("Quoted"))} href="/inventory/rfq" tone={rfqCount("Quoted") ? "warn" : "neutral"} />}
          </Section>
        )}

        {orders && (
          <Section title="Purchase orders" hint="Approved orders still to arrive, the soonest expected first." href="/inventory/orders">
            <Figures>
              <Figure label="Awaiting approval" value={String(toApprove.length)} tone={toApprove.length ? "warn" : "neutral"} />
              <Figure label="Still to arrive" value={aed(toReceive.reduce((s, o) => s + o.total, 0))} sub={plural(toReceive.length, "order")} />
              <Figure label="Late" value={String(late.length)} tone={late.length ? "bad" : "good"} />
            </Figures>
            <div className="mt-3">
              <List
                empty="Nothing is on order."
                rows={toReceive.slice(0, 5).map((o) => {
                  const d = o.expectedDate ? daysFrom(o.expectedDate, today) : null;
                  return { key: o.id, href: "/inventory/orders", label: `${o.number} · ${o.partyName}`, right: d === null ? o.status : dueText(d), tone: d !== null && d < 0 ? "bad" : "neutral" };
                })}
              />
            </div>
          </Section>
        )}

        {(monthMoves || returns !== null) && (
          <Section title="This month in the stores" hint="Since the 1st.">
            {monthMoves && (
              <Figures>
                <Figure label="Receipts" value={String(moved("Receipt")?._count ?? 0)} sub={aed(moved("Receipt")?._sum.value ?? 0)} />
                <Figure label="Issues to jobs" value={String(moved("Issue")?._count ?? 0)} sub={aed(moved("Issue")?._sum.value ?? 0)} />
                <Figure label="Returns from site" value={String(moved("Return to store")?._count ?? 0)} />
              </Figures>
            )}
            {awaitingInspection !== null && <Line label="Deliveries waiting for QA/QC inspection" value={String(awaitingInspection)} href="/inventory/movements" tone={awaitingInspection ? "warn" : "neutral"} />}
            {returns !== null && <Line label="Returns from site not yet posted" value={String(returns)} href="/inventory/returns" tone={returns ? "warn" : "neutral"} />}
          </Section>
        )}

        {cal && (
          <Section title="Equipment and calibration" hint="An instrument out of calibration must not be used on site." href="/inventory/equipment">
            {cal.equipment === 0 ? (
              <p className="rounded-lg bg-brand-paper px-3 py-4 text-center text-sm text-muted">No equipment is registered yet. Add instruments under Equipment to track their calibration here.</p>
            ) : (
            <Figures>
              <Figure label="Ready to use" value={String(cal.available)} tone="good" sub={`of ${cal.equipment}`} />
              <Figure label="Out of calibration" value={String(cal.expired)} tone={cal.expired ? "bad" : "neutral"} />
              <Figure label="Due within 30 days" value={String(cal.expiringSoon)} tone={cal.expiringSoon ? "warn" : "neutral"} />
            </Figures>
            )}
            {cal.neverCalibrated > 0 && <Line label="Never calibrated" value={String(cal.neverCalibrated)} href="/inventory/equipment" tone="warn" />}
          </Section>
        )}
      </Sections>
    </div>
  );
}
