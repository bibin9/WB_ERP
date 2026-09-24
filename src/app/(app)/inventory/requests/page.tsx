import Link from "next/link";
import { ClipboardList, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import RequestForm from "@/components/inventory/RequestForm";
import DocumentButtons from "@/components/DocumentButtons";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { balanceOf } from "@/lib/stock";
import { shortagesFor, shortageVerdict, REQUEST_STATUS_HELP } from "@/lib/purchasing";
import { syncRequestApproval } from "@/lib/purchase-posting";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const statusColour: Record<string, string> = {
  Draft: "bg-line text-muted",
  Submitted: "bg-brand-blue/10 text-brand-blue-600",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
  Ordered: "bg-brand-green/10 text-brand-green-700",
  Cancelled: "bg-line text-muted",
};

/**
 * Material requests (INV-01 to INV-04).
 *
 * Site says what the work needs; the request is checked against the shelf
 * before anybody buys anything, and routed for approval before it reaches
 * procurement.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string; show?: string }>;
}) {
  await requireAccess("inventory.requests");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const term = readSearch(sp);
  const showAll = sp.show === "all";
  const where = {
    companyId,
    ...(showAll ? {} : { status: { in: ["Draft", "Submitted", "Approved"] } }),
    ...(matchAny(term, ["number", "notes", "requestedBy"]) ?? {}),
  };
  const paging = readPaging(sp);
  const total = companyId ? await db.materialRequest.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const raw = companyId
    ? await db.materialRequest.findMany({
        where,
        include: {
          lines: { include: { item: true }, orderBy: { order: "asc" } },
          job: { select: { code: true, name: true } },
          store: { select: { code: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (info.page - 1) * info.perPage,
        take: info.perPage,
      })
    : [];

  // The approval is the source of truth; the request follows it on read, so
  // a decision made in the inbox cannot fail to arrive here.
  for (const r of raw) {
    if (r.status === "Submitted") await syncRequestApproval(r.id);
  }
  const requests = companyId
    ? await db.materialRequest.findMany({
        where: { id: { in: raw.map((r) => r.id) } },
        include: {
          lines: { include: { item: true }, orderBy: { order: "asc" } },
          job: { select: { code: true, name: true } },
          store: { select: { code: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  /**
   * INV-02. What is on the shelf right now, for every item any of these
   * requests mentions, so a shortage is shown before anybody buys.
   */
  const itemIds = [...new Set(requests.flatMap((r) => r.lines.map((l) => l.itemId).filter(Boolean)))] as string[];
  const onHand: Record<string, number> = {};
  if (itemIds.length) {
    // One total per item and kind, added up by the database. It used to load
    // every movement of every item on the page and filter the whole list
    // again for each item.
    const groups = await db.stockMovement.groupBy({
      by: ["itemId", "kind"],
      where: { companyId, itemId: { in: itemIds } },
      _sum: { quantity: true, value: true },
    });
    for (const id of itemIds) {
      onHand[id] = balanceOf(
        groups.filter((g) => g.itemId === id).map((g) => ({ kind: g.kind, quantity: g._sum.quantity ?? 0, value: g._sum.value ?? 0 })),
      ).quantity;
    }
  }

  const items = companyId
    ? await db.item.findMany({
        where: { companyId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, unitCode: true, isStocked: true },
      })
    : [];
  const jobs = companyId
    ? await db.job.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })
    : [];
  const stores = companyId
    ? await db.store.findMany({ where: { companyId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, isDefault: true } })
    : [];

  const awaiting = requests.filter((r) => r.status === "Submitted").length;

  return (
    <div>
      <PageHeader
        title="Stores — Material Requests"
        subtitle="What site needs, checked against the shelf before anybody buys it."
      >
        {companyId && items.length > 0 && (
          <RequestForm companyId={companyId} items={items} jobs={jobs} stores={stores} />
        )}
      </PageHeader>
      <InventoryTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {awaiting > 0 && (
        <div className="mb-5 rounded-lg border border-brand-blue/40 bg-brand-blue/5 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {awaiting === 1 ? "One request is" : `${awaiting} requests are`} waiting for approval.
          </span>{" "}
          Site in-charge, then the project manager, then procurement. They are in the{" "}
          <Link href="/approvals" className="underline">Approvals</Link> inbox.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search number, notes or who raised it" />
        <div className="flex items-center gap-2 text-sm">
          <a href={`/inventory/requests?c=${companyId}`} className={!showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>Live</a>
          <span className="text-line">|</span>
          <a href={`/inventory/requests?c=${companyId}&show=all`} className={showAll ? "font-medium text-ink" : "text-muted hover:text-ink"}>All</a>
        </div>
      </div>

      <div className="space-y-4">
        {requests.length === 0 && (
          <div className="card px-4 py-10 text-center text-muted">
            {total === 0 && !term
              ? "No material requests yet. Site raises one when the work needs something."
              : "Nothing matches."}
          </div>
        )}

        {requests.map((r) => {
          const shortages = shortagesFor(
            r.lines.map((l) => ({
              itemId: l.itemId,
              description: l.item ? `${l.item.code} — ${l.item.name}` : l.description,
              unitCode: l.unitCode,
              quantity: l.quantity,
            })),
            onHand,
          );
          const verdict = shortageVerdict(shortages);
          const anyShort = shortages.some((s) => !s.unknown && s.short > 0);

          return (
            <div key={r.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-heading">{r.number}</span>
                    <span
                      title={REQUEST_STATUS_HELP[r.status]}
                      className={`rounded px-1.5 py-0.5 text-xs ${statusColour[r.status] ?? "bg-line text-muted"}`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {r.job ? `${r.job.code} — ${r.job.name}` : "No job"} · raised by {r.requestedBy}
                    {r.neededBy && <> · needed by {fmt(r.neededBy)}</>}
                    {r.store && <> · for {r.store.code}</>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DocumentButtons kind="material-request" id={r.id} />
                  {r.status === "Approved" && (
                    <Link href={`/inventory/orders?c=${companyId}&from=${r.id}`} className="btn-primary">
                      Raise an order
                    </Link>
                  )}
                </div>
              </div>

              {verdict && (
                <p className={`mt-3 flex items-start gap-1.5 text-sm ${anyShort ? "text-ink" : "text-brand-green-700"}`}>
                  {anyShort && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />}
                  {verdict}
                </p>
              )}

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2 pr-4 font-medium">What is needed</th>
                      <th className="py-2 pr-4 text-right font-medium">Asked for</th>
                      <th className="py-2 pr-4 text-right font-medium">In stock</th>
                      <th className="py-2 pr-4 text-right font-medium">Short by</th>
                      <th className="py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shortages.map((s, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-4 text-ink">{s.description}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-ink">
                          {s.requested.toLocaleString()} <span className="text-xs text-muted">{s.unitCode}</span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted">
                          {s.unknown ? "—" : s.onHand.toLocaleString()}
                        </td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${s.short > 0 && !s.unknown ? "font-medium text-brand-gold" : "text-muted"}`}>
                          {s.unknown ? "—" : s.short > 0 ? s.short.toLocaleString() : "nothing"}
                        </td>
                        <td className="py-2 text-xs text-muted">
                          {s.unknown
                            ? "not in the catalogue"
                            : s.short === 0
                              ? "issue from the store"
                              : s.onHand > 0
                                ? "part from the store"
                                : "needs buying"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {r.notes && <p className="mt-3 text-xs text-muted">{r.notes}</p>}
            </div>
          );
        })}
      </div>

      <Pager info={info} label="requests" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          Every request is checked against what is already on the shelf before anybody buys anything. Site asking for
          cable the store already holds is not a mistake — it is the case the store exists for, and the answer is to
          issue it rather than order more. A line for something not in the catalogue is reported as unknown rather
          than as a shortage, because calling it a shortage would be a guess dressed as a fact.
        </p>
      </div>
    </div>
  );
}
