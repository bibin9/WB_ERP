import type { Prisma } from "@prisma/client";

/**
 * Searching a grid.
 *
 * The term travels in the query string, like the page number, so the database
 * filters rather than the browser hiding rows it already fetched — searching a
 * list you can only see fifty rows of is otherwise worse than useless.
 *
 * Case matters here in a way that is easy to get wrong. SQLite's LIKE is
 * already case-insensitive for ASCII and *rejects* Prisma's `mode` argument
 * outright; PostgreSQL's LIKE is case-sensitive and needs `mode` to ignore it.
 * Local development runs on the first and the client runs on the second, so
 * writing either one plainly gives you a search that works on your machine and
 * quietly misses half the matches on theirs, or one that crashes the moment you
 * type. Hence `like()`: the only place that difference is allowed to exist.
 */

const isPostgres = () => /^postgres(ql)?:/i.test(process.env.DATABASE_URL ?? "");

/** A case-insensitive "contains" that behaves the same on both engines. */
export function like(value: string): Prisma.StringFilter {
  return isPostgres()
    ? ({ contains: value, mode: "insensitive" } as Prisma.StringFilter)
    : ({ contains: value } as Prisma.StringFilter);
}

/**
 * The term as typed, trimmed and capped.
 *
 * Capped because it goes into a LIKE against several columns at once, and a
 * pasted paragraph is never a search — it is a stuck key or a paste into the
 * wrong box.
 */
export function readSearch(sp: { q?: string }): string {
  return String(sp.q ?? "").trim().slice(0, 80);
}

/**
 * Turn a term into a filter across several columns.
 *
 * Every field is optional in the caller's model or not, so `null` rows simply
 * do not match — which is what a person expects when they search for a phone
 * number and someone has not got one.
 */
export type AnyMatch = { OR: Record<string, Prisma.StringFilter>[] };

export function matchAny(term: string, fields: string[]): AnyMatch | undefined {
  if (!term) return undefined;
  return { OR: fields.map((f) => ({ [f]: like(term) })) };
}

/**
 * Build a filter that also matches a number, when the term looks like one.
 *
 * An accountant searching a day book types an amount as often as a reference,
 * and "1500" should find the voucher for 1,500.00 rather than nothing.
 */
export function numericTerm(term: string): number | null {
  const cleaned = term.replace(/[, ]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A phone number as it should be stored and searched: digits and a leading +,
 * nothing else.
 *
 * Nobody types the spaces in "050 412 8837", so a number kept that way can
 * never be found by typing it. Both the stored value and the search term are
 * reduced to the same shape, which makes either form match.
 */
export const normalisePhone = (raw: string): string => raw.replace(/[^\d+]/g, "");

/** True when a term is worth treating as a phone number rather than a name. */
export const looksLikePhone = (term: string): boolean => /^[+\d][\d\s()+-]{4,}$/.test(term);
