/**
 * Asking the audit trail a question.
 *
 * Two things carry this and both fail silently when wrong. A range that stops
 * at midnight hides the entries made during the day somebody asked about, and
 * looks perfectly healthy while doing it. And a filter read off a query string
 * must only ever narrow — one that could displace the tenant scope would reach
 * another customer's history, which is worse than having no filter at all.
 */
import { importLibs } from "./lib-shim.mjs";
import fs from "node:fs";

const libs = await importLibs(["auditquery", "db"]);
const {
  FILTER_ACTIONS, EMPTY_FILTER, readAuditFilter, isFiltered, auditWhere, describeFilter, filterQuery,
} = libs["auditquery"];
const { db } = libs["db"];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ================================================ reading the filter ===== */

ok("nothing in the query string filters nothing", !isFiltered(readAuditFilter({})));
ok("and the empty filter is the same shape",
  JSON.stringify(readAuditFilter({})) === JSON.stringify(EMPTY_FILTER));

{
  const f = readAuditFilter({ q: "  invoice  ", user: "Ahmed", action: "Deleted", entity: "Invoice", from: "2026-09-01", to: "2026-09-14" });
  ok("free text is trimmed", f.q === "invoice");
  ok("the person is kept", f.user === "Ahmed");
  ok("the action is kept", f.action === "Deleted");
  ok("the record type is kept", f.entity === "Invoice");
  ok("and the dates are kept", f.from === "2026-09-01" && f.to === "2026-09-14");
  ok("which counts as filtered", isFiltered(f));
}

/**
 * A pasted URL with a broken date should show the trail, not an error page.
 */
ok("a malformed date is dropped, not rejected", readAuditFilter({ from: "14-09-2026" }).from === "");
ok("an impossible date is dropped too", readAuditFilter({ from: "2026-02-31" }).from === "",
  "31 February parses as 3 March in JavaScript if you let it");
ok("an unknown action is dropped rather than searched for",
  readAuditFilter({ action: "Frobnicated" }).action === "",
  "otherwise a typo returns nothing and looks like an empty trail");
ok("every offered action survives being read back",
  FILTER_ACTIONS.every((a) => readAuditFilter({ action: a }).action === a), FILTER_ACTIONS.join(", "));

// Somebody who picks the dates the wrong way round means the range between.
{
  const f = readAuditFilter({ from: "2026-09-14", to: "2026-09-01" });
  ok("dates the wrong way round are swapped", f.from === "2026-09-01" && f.to === "2026-09-14");
}

ok("free text is capped", readAuditFilter({ q: "x".repeat(500) }).q.length === 80);

/* ==================================================== the where clause === */

ok("no filter is just the tenant",
  JSON.stringify(auditWhere("T1", EMPTY_FILTER)) === JSON.stringify({ tenantId: "T1" }));

/**
 * The rule that matters most. Nothing read off a query string may remove or
 * replace the tenant, whatever it is called.
 */
for (const hostile of [
  { q: "x" }, { user: "y" }, { action: "Deleted" }, { entity: "z" }, { from: "2026-01-01" },
]) {
  const w = auditWhere("T1", readAuditFilter(hostile));
  ok(`the tenant survives a filter on ${Object.keys(hostile)[0]}`, w.tenantId === "T1");
}
{
  // Even when the query string tries to name one itself.
  const w = auditWhere("T1", readAuditFilter({ tenantId: "T2", q: "x" }));
  ok("a tenant named in the query string is ignored", w.tenantId === "T1",
    "the scope is written last and cannot be displaced");
}

{
  const w = auditWhere("T1", readAuditFilter({ q: "invoice" }));
  const or = w.AND[0].OR;
  ok("free text looks across the summary, the person and the record type",
    or.length === 3 && or.some((c) => c.summary) && or.some((c) => c.userName) && or.some((c) => c.entity));
}

/**
 * The off-by-one. Asking for entries up to the fourteenth has to include the
 * fourteenth, or the day being asked about is the one day that is hidden.
 */
{
  const w = auditWhere("T1", readAuditFilter({ from: "2026-09-01", to: "2026-09-14" }));
  const range = w.AND.find((c) => c.createdAt).createdAt;
  ok("the range starts at the beginning of the first day",
    range.gte.toISOString() === "2026-09-01T00:00:00.000Z");
  ok("and ends at the end of the last one",
    range.lte.toISOString() === "2026-09-14T23:59:59.999Z",
    "not midnight, which would hide everything done that day");
}
{
  const w = auditWhere("T1", readAuditFilter({ from: "2026-09-01" }));
  const range = w.AND.find((c) => c.createdAt).createdAt;
  ok("an open-ended range has no upper bound", range.lte === undefined && !!range.gte);
}

/* ============================================ against the real table ===== */

{
  const tenant = await db.tenant.findFirst({ where: { key: "wandb" } });
  const stamp = `AUDITQ-${Date.now()}`;
  const day = (iso) => new Date(iso);

  const rows = [
    { userName: "Filter Tester", action: "Deleted", entity: "Invoice", summary: `${stamp} deleted one`, createdAt: day("2026-09-14T23:30:00.000Z") },
    { userName: "Filter Tester", action: "Created", entity: "Invoice", summary: `${stamp} created one`, createdAt: day("2026-09-01T00:05:00.000Z") },
    { userName: "Someone Else", action: "Deleted", entity: "Employee", summary: `${stamp} unrelated`, createdAt: day("2026-09-07T12:00:00.000Z") },
  ];
  const made = [];
  try {
    for (const r of rows) {
      const row = await db.auditLog.create({ data: { tenantId: tenant.id, ...r } });
      made.push(row.id);
    }

    const count = async (sp) =>
      db.auditLog.count({ where: { AND: [auditWhere(tenant.id, readAuditFilter(sp)), { summary: { contains: stamp } }] } });

    ok("free text finds the entries", (await count({ q: stamp })) === 3);
    ok("filtering by person narrows it", (await count({ q: stamp, user: "Filter Tester" })) === 2);
    ok("filtering by action narrows it", (await count({ q: stamp, action: "Deleted" })) === 2);
    ok("filtering by record type narrows it", (await count({ q: stamp, entity: "Invoice" })) === 2);
    ok("and the two together narrow it further",
      (await count({ q: stamp, action: "Deleted", entity: "Invoice" })) === 1);

    /**
     * The entry at half past eleven at night on the fourteenth is the one a
     * midnight boundary would lose.
     */
    ok("a range includes an entry late on its last day",
      (await count({ q: stamp, from: "2026-09-01", to: "2026-09-14" })) === 3,
      "23:30 on the fourteenth is inside 'up to the fourteenth'");
    ok("and excludes what falls outside it",
      (await count({ q: stamp, from: "2026-09-02", to: "2026-09-13" })) === 1);

    ok("searching for something absent returns nothing rather than everything",
      (await count({ q: stamp, user: "Nobody At All" })) === 0);
  } finally {
    if (made.length) await db.auditLog.deleteMany({ where: { id: { in: made } } });
  }
}

/* ====================================================== the sentence ===== */

ok("an unfiltered view says nothing", describeFilter(EMPTY_FILTER, 100) === "");

{
  const f = readAuditFilter({ action: "Deleted", entity: "Invoice", user: "Ahmed", from: "2026-09-01", to: "2026-09-14" });
  const s = describeFilter(f, 12);
  ok("a filtered view says what it is showing", /Showing 12 deleted entries on Invoice by Ahmed/.test(s), s);
  ok("  including the range", /between 01 Sept? 2026 and 14 Sept? 2026/.test(s), s);
  ok("  and says the last day is included", /and 14 Sept? 2026/.test(s));
}
ok("one result reads as one", /Showing the one entry/.test(describeFilter(readAuditFilter({ q: "x" }), 1)),
  describeFilter(readAuditFilter({ q: "x" }), 1));
ok("an open end reads plainly",
  /up to and including/.test(describeFilter(readAuditFilter({ to: "2026-09-14" }), 3)));
ok("and an open start too",
  /from 01 Sept? 2026 onwards/.test(describeFilter(readAuditFilter({ from: "2026-09-01" }), 3)));

/* ------------------------------------------------------ shareable link -- */
{
  const f = readAuditFilter({ q: "invoice", action: "Deleted" });
  const qs = filterQuery(f, { src: "archive" });
  ok("a filtered view can be linked", qs.includes("q=invoice") && qs.includes("action=Deleted"));
  ok("  carrying the tab with it", qs.includes("src=archive"),
    "a filter that resets when you open the archive is a filter nobody uses twice");
  ok("  and empty fields are left out", !qs.includes("user="));
  ok("an empty filter makes no query string", filterQuery(EMPTY_FILTER) === "");
}

/* ==================================================== how it is wired ==== */

const page = read("src/app/(app)/audit/page.tsx");
ok("the screen reads the filter", /readAuditFilter/.test(page));
ok("and both the list and the counts use it", (page.match(/auditWhere/g) ?? []).length >= 2,
  "a count that ignores the filter says 4,000 above a list of three");
ok("the archive is filtered the same way", /auditLogArchive[\s\S]*?where/.test(page));
ok("the filter bar is on the screen", /<AuditFilters/.test(page));

const helpSrc = read("src/lib/help.ts");
ok("there is plain-English help", /id: "audit-search"/.test(helpSrc));

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
