/**
 * Paging a grid.
 *
 * Most of these tables were unbounded. That is invisible on demo data and
 * unusable a year in: a day book holding every voucher the company has ever
 * posted renders every one of them, on every visit, into one page the browser
 * then has to lay out. The first sign is not an error, it is the screen taking
 * six seconds to appear, and by then it is the client's live system.
 *
 * The page number travels in the query string rather than in component state,
 * because these are server-rendered screens: the database should fetch one
 * page, not fetch everything and throw most of it away. It also means a link to
 * page four is a link to page four.
 */

export const PER_PAGE = 50;

/** The choices offered, so a printed page can be made to hold more. */
export const PAGE_SIZES = [25, 50, 100, 200];

export type Paging = {
  page: number;
  perPage: number;
  /** For the database query. */
  skip: number;
  take: number;
};

/**
 * Read the page and size out of the query string, defensively: a hand-edited
 * URL should land somewhere sensible rather than ask for row minus one.
 */
export function readPaging(sp: { p?: string; per?: string }, fallback = PER_PAGE): Paging {
  const perRaw = Number(sp.per);
  const perPage = PAGE_SIZES.includes(perRaw) ? perRaw : fallback;
  const pageRaw = Number(sp.p);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export type PageInfo = {
  page: number;
  perPage: number;
  total: number;
  pages: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

/**
 * What the pager needs to describe itself.
 *
 * `from` and `to` are one-based and inclusive, because "showing 51 to 100 of
 * 237" is what a person reads, not "offset 50, limit 50".
 */
export function pageInfo(p: Paging, total: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / p.perPage));
  const page = Math.min(p.page, pages);
  const from = total === 0 ? 0 : (page - 1) * p.perPage + 1;
  const to = Math.min(total, page * p.perPage);
  return { page, perPage: p.perPage, total, pages, from, to, hasPrev: page > 1, hasNext: page < pages };
}
