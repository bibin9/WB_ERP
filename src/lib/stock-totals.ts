import "server-only";
import { db } from "./db";
import { isInward, type MovementLike } from "./stock";

/**
 * Stock totals added up by the database, not by the page.
 *
 * Stock on Hand and Receive & Issue used to load every movement the company had
 * ever recorded and add them up in memory. With thirty thousand movements that
 * was the slowest thing in the system, and it grows without limit: a store
 * that records fifty movements a day reaches that in two years.
 *
 * The database now totals them per item and store, per kind and inspection
 * state. balanceOf only ever adds movements up by kind and inspection, so
 * handing it one total per group gives exactly the figures it gave from the
 * individual rows — the average cost, the quantity awaiting inspection, the
 * usable quantity — from a few dozen rows instead of thousands.
 */

type Group = { kind: string; inspection: string | null; _sum: { quantity: number | null; value: number | null } };

const asMovements = (g: Group): MovementLike => ({
  kind: g.kind,
  inspection: g.inspection,
  quantity: g._sum.quantity ?? 0,
  value: g._sum.value ?? 0,
});

/** Movement totals per item, optionally for one store, ready for balanceOf. */
export async function totalsByItem(companyId: string, storeId?: string | null): Promise<Map<string, MovementLike[]>> {
  const groups = await db.stockMovement.groupBy({
    by: ["itemId", "kind", "inspection"],
    where: { companyId, ...(storeId ? { storeId } : {}) },
    _sum: { quantity: true, value: true },
  });
  const out = new Map<string, MovementLike[]>();
  for (const g of groups) {
    const list = out.get(g.itemId) ?? [];
    list.push(asMovements(g));
    out.set(g.itemId, list);
  }
  return out;
}

/** Movement totals per item in each store, keyed "itemId:storeId". */
export async function totalsByItemAndStore(companyId: string): Promise<Map<string, MovementLike[]>> {
  const groups = await db.stockMovement.groupBy({
    by: ["itemId", "storeId", "kind", "inspection"],
    where: { companyId },
    _sum: { quantity: true, value: true },
  });
  const out = new Map<string, MovementLike[]>();
  for (const g of groups) {
    const key = `${g.itemId}:${g.storeId}`;
    const list = out.get(key) ?? [];
    list.push(asMovements(g));
    out.set(key, list);
  }
  return out;
}

/** What each bin holds of each item, keyed "itemId:binId". */
export async function binHoldingsFor(companyId: string): Promise<Record<string, number>> {
  const groups = await db.stockMovement.groupBy({
    by: ["itemId", "binId", "kind"],
    where: { companyId, binId: { not: null } },
    _sum: { quantity: true },
  });
  const out: Record<string, number> = {};
  for (const g of groups) {
    const key = `${g.itemId}:${g.binId}`;
    out[key] = (out[key] ?? 0) + (isInward(g.kind) ? 1 : -1) * (g._sum.quantity ?? 0);
  }
  return out;
}

/**
 * Per store: movement totals by bin, kind and inspection state, and how many
 * movements there were. Each group carries its binId, so the same list serves
 * balanceOf (value held) and binQuantities (what each bin holds). The Stores
 * screen used to load every movement of every store for these three figures.
 */
export async function totalsByStore(companyId: string): Promise<Map<string, { groups: (MovementLike & { binId: string | null })[]; count: number }>> {
  const groups = await db.stockMovement.groupBy({
    by: ["storeId", "binId", "kind", "inspection"],
    where: { companyId },
    _sum: { quantity: true, value: true },
    _count: { _all: true },
  });
  const out = new Map<string, { groups: (MovementLike & { binId: string | null })[]; count: number }>();
  for (const g of groups) {
    const at = out.get(g.storeId) ?? { groups: [], count: 0 };
    at.groups.push({ ...asMovements(g), binId: g.binId });
    at.count += g._count._all;
    out.set(g.storeId, at);
  }
  return out;
}
