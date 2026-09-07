/**
 * Arranging a costing dimension into a tree.
 *
 * Jobs and cost centres both roll up: costs are posted to the leaf a person
 * actually worked on, and a parent is only ever the sum of what sits beneath
 * it. Nothing is posted to a parent directly, so a parent's figures have to be
 * derived rather than stored — stored totals drift the moment a voucher is
 * reversed.
 *
 * Both the ordering and the roll-up are cycle-safe. A cycle should be
 * impossible (the actions refuse to create one), but a report that hangs is a
 * far worse failure than one that quietly treats an orphan as top-level, and
 * data can arrive from an import that never went through those actions.
 */

export type TreeRow = { id: string; parentId: string | null };

export type Arranged<T> = {
  node: T;
  /** 0 for a top-level row; used only for indentation. */
  depth: number;
  /** Every id beneath this one, excluding itself. Empty for a leaf. */
  descendants: string[];
  hasChildren: boolean;
};

/**
 * Depth-first order — every parent immediately followed by its children — with
 * the descendants of each row, so the caller can total whatever it likes
 * without walking the tree again.
 *
 * Rows whose parent is missing or unreachable are treated as top-level, so
 * nothing ever disappears from a report.
 */
export function arrange<T extends TreeRow>(rows: T[]): Arranged<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string | null, T[]>();

  // A parent that is not in this list (filtered out, or deleted) makes the row
  // top-level rather than invisible.
  for (const r of rows) {
    const key = r.parentId && byId.has(r.parentId) ? r.parentId : null;
    const list = children.get(key);
    if (list) list.push(r);
    else children.set(key, [r]);
  }

  const out: Arranged<T>[] = [];
  const seen = new Set<string>();

  const walk = (row: T, depth: number): string[] => {
    if (seen.has(row.id)) return []; // a cycle, or a row reachable twice
    seen.add(row.id);
    const slot: Arranged<T> = { node: row, depth, descendants: [], hasChildren: false };
    out.push(slot);
    const kids = children.get(row.id) ?? [];
    slot.hasChildren = kids.length > 0;
    const below: string[] = [];
    for (const kid of kids) below.push(kid.id, ...walk(kid, depth + 1));
    slot.descendants = below;
    return below;
  };

  for (const row of children.get(null) ?? []) walk(row, 0);
  // Anything left is inside a cycle. Show it flat rather than losing it.
  for (const row of rows) if (!seen.has(row.id)) walk(row, 0);

  return out;
}

/** Sum a measure over a row and everything beneath it. */
export function withDescendants<T extends TreeRow>(
  row: Arranged<T>,
  measure: Map<string, number>
): number {
  let total = measure.get(row.node.id) ?? 0;
  for (const id of row.descendants) total += measure.get(id) ?? 0;
  return total;
}
