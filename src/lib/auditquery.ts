/**
 * Asking the audit trail a question.
 *
 * The trail had pagination and an archive and no way to search either. That is
 * fine for a week of entries and useless for a year of them: "who deleted that
 * invoice", "what did this person do on the fourteenth" and "show me every
 * failed sign-in last month" are the only questions anybody ever brings to an
 * audit log, and none of them could be answered without scrolling.
 *
 * A record you can only scroll is not evidence. It is a file nobody opens.
 *
 * The two rules that matter
 * -------------------------
 * A filter narrows and never widens. The tenant scope is applied last and
 * cannot be displaced by anything read off a query string, because a filter
 * that could reach another customer's history would be far worse than no
 * filter at all.
 *
 * A date range includes the whole of its last day. Asking for entries up to the
 * fourteenth and silently getting nothing after midnight on the thirteenth is
 * the kind of off-by-one that hides exactly the entry somebody is looking for,
 * and it hides it without ever looking broken.
 *
 * Not server-only: the filter bar reads and writes the same shape.
 */

/** Actions worth offering as a filter, grouped the way people ask for them. */
export const FILTER_ACTIONS = [
  "Created",
  "Updated",
  "Deleted",
  "Posted",
  "Approved",
  "Rejected",
  "Signed in",
  "Signed out",
  "Sign-in failed",
  "Locked out",
] as const;

export type AuditFilter = {
  /** Free text, matched against the summary, the person and the record type. */
  q: string;
  /** Exactly one person, by the name stored on the entry. */
  user: string;
  action: string;
  entity: string;
  /** Inclusive, yyyy-mm-dd. */
  from: string;
  to: string;
};

export const EMPTY_FILTER: AuditFilter = { q: "", user: "", action: "", entity: "", from: "", to: "" };

/**
 * A real calendar date, not merely one that parses.
 *
 * Date.parse accepts "2026-02-31" and hands back 3 March, so a filter for a day
 * that does not exist would silently become a different day. Round-tripping it
 * is the only reliable check.
 */
const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Read a filter off the query string.
 *
 * Anything malformed is dropped rather than rejected. A bad date in a URL
 * somebody pasted should show the unfiltered trail, not an error page.
 */
export function readAuditFilter(sp: Record<string, string | undefined>): AuditFilter {
  const text = (v: string | undefined, max = 80) => String(v ?? "").trim().slice(0, max);
  const date = (v: string | undefined) => {
    const s = text(v, 10);
    return isDate(s) ? s : "";
  };

  let from = date(sp.from);
  let to = date(sp.to);
  // Someone who picks the dates the wrong way round means the range between
  // them, not an empty result.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: text(sp.q),
    user: text(sp.user, 120),
    action: FILTER_ACTIONS.includes(text(sp.action) as (typeof FILTER_ACTIONS)[number]) ? text(sp.action) : "",
    entity: text(sp.entity, 60),
    from,
    to,
  };
}

/** Whether anything is actually being filtered. */
export const isFiltered = (f: AuditFilter): boolean =>
  Boolean(f.q || f.user || f.action || f.entity || f.from || f.to);

/**
 * The Prisma filter for one tenant's trail.
 *
 * The tenant is written last and spread over nothing, so no combination of
 * query-string values can remove or replace it.
 */
export function auditWhere(tenantId: string, f: AuditFilter) {
  const and: Record<string, unknown>[] = [];

  if (f.q) {
    and.push({
      OR: [
        { summary: { contains: f.q } },
        { userName: { contains: f.q } },
        { entity: { contains: f.q } },
      ],
    });
  }
  if (f.user) and.push({ userName: f.user });
  if (f.action) and.push({ action: f.action });
  if (f.entity) and.push({ entity: f.entity });

  const range: Record<string, Date> = {};
  if (f.from) range.gte = new Date(f.from + "T00:00:00.000Z");
  // The whole of the last day, not the instant it began. Anything else hides
  // the entries made during the day somebody asked about.
  if (f.to) range.lte = new Date(f.to + "T23:59:59.999Z");
  if (f.from || f.to) and.push({ createdAt: range });

  return and.length ? { tenantId, AND: and } : { tenantId };
}

const pretty = (iso: string) =>
  new Date(iso + "T00:00:00.000Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * What is being shown, in a sentence.
 *
 * A filtered list that looks like an unfiltered one is how somebody concludes
 * a record does not exist when it is simply outside the range they left set
 * three screens ago.
 */
export function describeFilter(f: AuditFilter, count: number): string {
  if (!isFiltered(f)) return "";

  const parts: string[] = [];
  if (f.action) parts.push(`${f.action.toLowerCase()} entries`);
  else parts.push("entries");
  if (f.entity) parts.push(`on ${f.entity}`);
  if (f.user) parts.push(`by ${f.user}`);
  if (f.q) parts.push(`matching "${f.q}"`);
  if (f.from && f.to) parts.push(`between ${pretty(f.from)} and ${pretty(f.to)}`);
  else if (f.from) parts.push(`from ${pretty(f.from)} onwards`);
  else if (f.to) parts.push(`up to and including ${pretty(f.to)}`);

  const n = count.toLocaleString();
  const noun = count === 1 ? "entry" : parts.shift()!;
  return count === 1
    ? `Showing the one ${["entry", ...parts].join(" ")}.`
    : `Showing ${n} ${[noun, ...parts].join(" ")}.`;
}

/** The query string for a filter, so a filtered view can be linked or shared. */
export function filterQuery(f: AuditFilter, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
