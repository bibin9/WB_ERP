/**
 * Where in the store it actually is (INV-14).
 *
 * A store tells you the company owns 400 metres of cable. It does not tell the
 * storeman which rack to walk to, and on a yard with six containers that is the
 * whole question. So a store can be divided into zones, and a zone into bins.
 *
 * What a bin is not
 * -----------------
 * It is not an accounting dimension. Stock is valued per item per store, the
 * ledger posts per store, and none of that changes here — a bin answers "where
 * do I walk to", not "what is it worth". Making valuation per-bin would mean
 * every issue had to pick the right bin before the accounts could be trusted,
 * and the accounts would then be wrong every time somebody guessed.
 *
 * Adopted a store at a time
 * -------------------------
 * A store with no bins defined carries on exactly as before. A store that has
 * bins requires one on every movement in it, because half-binned stock is worse
 * than none: the bin totals stop agreeing with the shelf, and nobody can tell
 * whether the difference is a missing bin or missing stock.
 *
 * So the rule is not "bins are required" but "a store either uses them or does
 * not", which is a decision the storekeeper makes by creating the first bin.
 *
 * Why the material type only warns
 * --------------------------------
 * A bin can say what it is meant to hold — cable, consumables, instruments —
 * and putting something else in it is flagged rather than refused. A storeman
 * putting a drum in the wrong bin at six on a Friday because the right one is
 * full is solving a problem, not creating one. Refuse them and they stop
 * recording bins at all, and no location data is worse than imperfect location
 * data.
 *
 * Not server-only: the forms warn before anything is saved.
 */

import { INWARD } from "./stock";

export const STORE_KINDS = ["Main store", "Site store", "Plant yard", "Lay-down area"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

export const STORE_KIND_HELP: Record<string, string> = {
  "Main store": "The central store material is bought into and issued from.",
  "Site store": "A container or room on a project, holding material already allocated to that job.",
  "Plant yard": "Where plant and heavy equipment sits between jobs.",
  "Lay-down area": "Open ground for material too big to shelve — pipe, structural steel, cable drums.",
};

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export type BinLike = {
  id: string;
  code: string;
  zone?: string | null;
  name?: string | null;
  /** What this bin is meant to hold, matched against the item's category. */
  materialType?: string | null;
  isActive?: boolean;
};

export type BinMovementLike = {
  binId?: string | null;
  kind: string;
  quantity: number;
};

/**
 * A bin's full name: zone and bin, the way somebody says it out loud.
 *
 * "B / 12" rather than "12", because a bin number on its own is ambiguous the
 * moment a second zone exists, and the second zone always arrives.
 */
export function binLabel(bin: { code: string; zone?: string | null }): string {
  const zone = String(bin.zone ?? "").trim();
  return zone ? `${zone} / ${bin.code}` : bin.code;
}

/** How much of one item sits in each bin, derived from movements like everything else. */
export function binQuantities(movements: BinMovementLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movements) {
    if (!m.binId) continue;
    const sign = INWARD.has(m.kind) ? 1 : -1;
    out[m.binId] = round3((out[m.binId] ?? 0) + sign * (Number(m.quantity) || 0));
  }
  return out;
}

/**
 * Whether this store expects a bin on its movements.
 *
 * Asked of the store's own bins rather than of a setting, so turning bins on is
 * creating one and turning them off is removing the last — there is no switch
 * to leave in the wrong position.
 */
export function storeUsesBins(bins: BinLike[]): boolean {
  return bins.some((b) => b.isActive !== false);
}

/**
 * Whether a movement may name this bin, and take this much out of it.
 *
 * `available` is what the bin holds of the item being moved, and is ignored on
 * an inward movement — putting material into a bin needs no stock in it.
 */
export function checkBin(
  bins: BinLike[],
  binId: string | null | undefined,
  kind: string,
  quantity: number,
  available = 0,
  itemName = "this item",
): { ok: true } | { ok: false; error: string } {
  const live = bins.filter((b) => b.isActive !== false);

  if (!live.length) {
    // A store with no bins does not use them. Naming one would be naming a bin
    // in another store, which is how stock goes missing on paper.
    if (binId) return { ok: false, error: "That bin is not in this store." };
    return { ok: true };
  }

  if (!binId) {
    return {
      ok: false,
      error:
        "Say which bin. This store is divided into bins, and material put away " +
        "without one stops the bin totals agreeing with the shelf.",
    };
  }

  const bin = live.find((b) => b.id === binId);
  if (!bin) return { ok: false, error: "That bin is not in this store." };

  if (INWARD.has(kind)) return { ok: true };

  const q = round3(quantity);
  const have = round3(available);
  if (have <= 0) {
    return {
      ok: false,
      error: `There is none of ${itemName} in bin ${binLabel(bin)}. Check which bin it is actually in.`,
    };
  }
  if (q > have) {
    return {
      ok: false,
      error:
        `Bin ${binLabel(bin)} holds ${have.toLocaleString()} of ${itemName}, not ${q.toLocaleString()}. ` +
        `Take the rest from another bin, or count this one.`,
    };
  }
  return { ok: true };
}

/**
 * Whether this item belongs in this bin, as a sentence or nothing.
 *
 * Returns a warning rather than a refusal, on purpose. See the note at the top
 * of this file: a rule that stops a storeman working is a rule that stops the
 * bins being recorded.
 */
export function binMismatch(bin: BinLike | undefined, itemCategory: string | null | undefined): string {
  if (!bin) return "";
  const wants = String(bin.materialType ?? "").trim();
  const is = String(itemCategory ?? "").trim();
  if (!wants || !is) return "";
  if (wants.toLowerCase() === is.toLowerCase()) return "";
  return `Bin ${binLabel(bin)} is meant for ${wants}, and this is ${is}. It will be recorded either way.`;
}

export type BinOccupancy = {
  bins: number;
  zones: number;
  /** Bins with something in them. */
  used: number;
  empty: number;
};

export function summariseBins(bins: BinLike[], quantities: Record<string, number>): BinOccupancy {
  const live = bins.filter((b) => b.isActive !== false);
  const used = live.filter((b) => (quantities[b.id] ?? 0) > 0).length;
  return {
    bins: live.length,
    zones: new Set(live.map((b) => String(b.zone ?? "").trim()).filter(Boolean)).size,
    used,
    empty: live.length - used,
  };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * What the storeman needs to know about this store's layout, in a sentence.
 */
export function binVerdict(bins: BinLike[], quantities: Record<string, number>): string {
  const t = summariseBins(bins, quantities);
  if (!t.bins) {
    return "This store is not divided into bins. Add one to start recording where material is put away.";
  }

  const parts = [
    t.zones > 0
      ? `${plural(t.bins, "bin")} across ${plural(t.zones, "zone")}.`
      : `${plural(t.bins, "bin")}, none in a named zone.`,
  ];
  if (t.used === 0) parts.push("Nothing has been put away yet.");
  else parts.push(`${t.used} holding something, ${t.empty} empty.`);
  return parts.join(" ");
}
