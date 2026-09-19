import Link from "next/link";
import { Undo2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PrintHeader from "@/components/finance/PrintHeader";
import CompanyPicker from "@/components/CompanyPicker";
import InventoryTabs from "@/components/InventoryTabs";
import PrintReport from "@/components/finance/PrintReport";
import SearchBox from "@/components/SearchBox";
import Pager from "@/components/Pager";
import ReturnForm from "@/components/inventory/ReturnForm";
import DocumentButtons from "@/components/DocumentButtons";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { money } from "@/lib/money";
import { readPaging, pageInfo } from "@/lib/paging";
import { readSearch, matchAny } from "@/lib/search";
import { totalsByItemAndStore } from "@/lib/stock-totals";
import { balanceOf } from "@/lib/stock";
import { CONDITION_HELP, RETURN_STATUS_HELP, summariseReturn } from "@/lib/returns";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; p?: string; per?: string }>;
}) {
  await requireAccess("inventory.returns");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const companyName = accessible.find((c) => c.id === companyId)?.name ?? "";
  const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;

  const term = readSearch(sp);
  const where = { companyId, ...(matchAny(term, ["number", "returnedBy", "notes"]) ?? {}) };
  const paging = readPaging(sp);
  const total = companyId ? await db.materialReturn.count({ where }) : 0;
  const info = pageInfo(paging, total);

  const notes = companyId
    ? await db.materialReturn.findMany({
        where,
        include: {
          job: { select: { code: true, name: true } },
          store: { select: { code: true } },
          lines: { include: { item: { select: { code: true, name: true, unitCode: true } } }, orderBy: { sortOrder: "asc" } },
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
        select: { id: true, code: true, name: true, unitCode: true },
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

  /**
   * The bins in each store (INV-14).
   *
   * Reusable material goes back on a shelf, and a store divided into bins will
   * not take a movement that does not say which one. Without these the return
   * screen could not put anything back into the main store at all.
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

  /**
   * What every job still has out, and what every shelf says its stock is worth.
   *
   * Handed to the form so a storeman finds out at the gate that the job only
   * has forty metres out, rather than after filling in the whole note. The
   * server checks it again and is the one that decides.
   */
  const positions: Record<string, { issued: number; returned: number }> = {};
  const averageCost: Record<string, number> = {};
  if (companyId) {
    // Totalled by the database: one row per job, item and kind, and one list
    // of totals per shelf — not every movement the company has recorded.
    const [onJobs, shelves] = await Promise.all([
      db.stockMovement.groupBy({
        by: ["jobId", "itemId", "kind"],
        where: { companyId, jobId: { not: null }, kind: { in: ["Issue", "Return to store"] } },
        _sum: { quantity: true },
      }),
      totalsByItemAndStore(companyId),
    ]);
    for (const m of onJobs) {
      const key = `${m.jobId}:${m.itemId}`;
      const at = (positions[key] ??= { issued: 0, returned: 0 });
      if (m.kind === "Issue") at.issued += m._sum.quantity ?? 0;
      else at.returned += m._sum.quantity ?? 0;
    }
    for (const [key, list] of shelves) averageCost[key] = balanceOf(list).averageCost;
  }

  const anyOut = Object.values(positions).some((p) => p.issued - p.returned > 0);

  return (
    <div>
      <PrintHeader companyName={companyName} logoUrl={company?.logoUrl} title="Material Returns" />

      <PageHeader
        title="Returns from Site"
        subtitle="What came back, what went on the shelf, and what the job kept the cost of."
      >
        <div className="flex flex-wrap items-center gap-2">
          <PrintReport />
          {companyId && stores.length > 0 && items.length > 0 && jobs.length > 0 && (
            <ReturnForm
              companyId={companyId}
              items={items}
              jobs={jobs}
              stores={stores}
              bins={binsByStore}
              positions={positions}
              averageCost={averageCost}
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

      {companyId && !anyOut && total === 0 && (
        <div className="mb-5 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">No job has any material out yet.</span> Material can only come back from a
          job it was issued to, so issue something on{" "}
          <Link href="/inventory/movements" className="underline">Receive &amp; Issue</Link> first.
        </div>
      )}

      <div className="mb-4">
        <SearchBox placeholder="Search note number, who brought it back, or notes" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Note</th>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">From job</th>
              <th className="px-4 py-2.5 font-medium">Into store</th>
              <th className="px-4 py-2.5 font-medium">What came back</th>
              <th className="px-4 py-2.5 text-right font-medium">Back on the shelf</th>
              <th className="px-4 py-2.5 text-right font-medium">Scrapped</th>
              <th className="px-4 py-2.5 text-right font-medium">Credited to job</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {notes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {total === 0 && !term
                    ? "Nothing has come back from site yet."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {notes.map((n) => {
              const t = summariseReturn(n.lines);
              return (
                <tr key={n.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="font-mono text-xs text-heading">{n.number}</span>
                    <div className="text-xs text-muted">{n.returnedBy}</div>
                    <DocumentButtons compact kind="material-return" id={n.id} label="Note" title="Material return note" />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmt(n.date)}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-heading">{n.job.code}</span>
                    <div className="text-xs text-muted">{n.job.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{n.store.code}</td>
                  <td className="px-4 py-2.5">
                    {n.lines.map((l) => (
                      <div key={l.id} className="text-xs">
                        <span
                          title={CONDITION_HELP[l.condition]}
                          className={`mr-1.5 rounded px-1.5 py-0.5 ${
                            l.condition === "Reusable"
                              ? "bg-brand-green/10 text-brand-green-700"
                              : "bg-brand-gold/10 text-brand-gold"
                          }`}
                        >
                          {l.condition}
                        </span>
                        <span className="text-ink">{l.item.code}</span>{" "}
                        <span className="text-muted">
                          {l.quantity.toLocaleString()} {l.item.unitCode}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-brand-green-700">
                    {t.reusableQuantity ? t.reusableQuantity.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {t.scrapQuantity ? t.scrapQuantity.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{money(t.creditedToJob)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    <span
                      title={RETURN_STATUS_HELP[n.status]}
                      className={`rounded px-1.5 py-0.5 ${
                        n.status === "Posted"
                          ? "bg-brand-green/10 text-brand-green-700"
                          : "bg-brand-blue/10 text-brand-blue-600"
                      }`}
                    >
                      {n.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager info={info} label="return notes" />

      <div className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Undo2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="max-w-3xl">
          A job draws more than it needs, because running short on a Friday costs more than a spare coil of cable
          does. What comes back is either still usable or it is not, and those are two different events however
          similar they look on the back of a lorry. Reusable material goes back on the shelf at what it cost and the
          job is credited the same. Scrap is recorded but credits nothing: the job consumed it, so the job keeps the
          cost. Putting scrap back at full value would inflate the shelf with material nobody can use, and putting it
          back at nil value would dilute the average of everything beside it. Nothing here can be edited — a
          correction is a new note, so the history still explains itself.
        </p>
      </div>
    </div>
  );
}
