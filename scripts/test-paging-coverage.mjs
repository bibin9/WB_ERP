/**
 * Which grids are bounded, and why the rest are allowed not to be.
 *
 * The failure this guards against is invisible on demo data: a screen that
 * renders every row it has ever held is fine for a year and then takes six
 * seconds, on the client's live system, with nobody having changed anything.
 *
 * So every list that grows without limit pages. A screen is allowed to skip it
 * only for a reason that holds as the business runs — it shows one period, one
 * account, one day, one company's masters, or it is a tree whose roll-up a page
 * boundary would break. Those exemptions are named below, one by one: adding a
 * screen to that list is a decision somebody has to write down.
 */
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

const ROOT = "src/app/(app)";
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : e.name === "page.tsx" ? [full.replace(/\\/g, "/")] : [];
});

/**
 * Screens with a table and no pager, each with the reason it does not need one.
 * A reason is a sentence somebody can check, not "it is small".
 */
const BOUNDED = {
  "crm/sources/page.tsx": "one row per source — a fixed list",
  "finance/bank-rec/page.tsx": "one statement at a time",
  "finance/cash-flow/page.tsx": "a forecast of weeks ahead, not a list",
  "finance/corporate-tax/page.tsx": "one return",
  "finance/cost-centres/page.tsx": "one row per cost centre, a company's own chart",
  "finance/einvoicing/page.tsx": "capped by take, newest first",
  "finance/jobs/page.tsx": "a tree that rolls children into parents; opens on live jobs only",
  "finance/ledgers/page.tsx": "one account for one period",
  "finance/page.tsx": "the chart of accounts, a company's own",
  "finance/trial-balance/page.tsx": "one row per account, for one period",
  "finance/vat/page.tsx": "one return period",
  "finance/wip/page.tsx": "one row per open job, for one period",
  "hr/attendance/page.tsx": "one day's muster, bounded by headcount",
  "hr/certifications/page.tsx": "capped by take, expiring first",
  "hr/manhours/page.tsx": "one period, grouped by job",
  "hr/overtime/page.tsx": "one period",
  "hr/payroll/page.tsx": "one run at a time",
  "hr/reports/page.tsx": "expiries, bounded by headcount",
  "hr/separation/page.tsx": "capped by take",
  "hr/workforce/page.tsx": "one row per employee, bounded by headcount",
  "inventory/equipment/page.tsx": "capped by take",
  "inventory/stores/page.tsx": "one row per store",
  "settings/email/page.tsx": "one row per company",
};

const pages = walk(ROOT);
const unpaged = [];
for (const f of pages) {
  const rel = f.slice(ROOT.length + 1);
  if (rel.includes("[")) continue; // a detail page shows one document
  const src = read(f);
  if (!src.includes("<table")) continue;
  if (/Pager|readPaging/.test(src)) continue;
  unpaged.push(rel);
}

const unexplained = unpaged.filter((rel) => !BOUNDED[rel]);
ok("every grid either pages or has a written reason it does not need to",
  unexplained.length === 0,
  unexplained.join(", ") || `${unpaged.length} exempt, ${pages.length} screens checked`);

const stale = Object.keys(BOUNDED).filter((rel) => !unpaged.includes(rel));
ok("and no reason is left behind for a screen that now pages",
  stale.length === 0, stale.join(", ") || `${Object.keys(BOUNDED).length} reasons`);

/* ===================== the ones that had to be paged ==================== */

for (const [rel, label] of [
  ["hr/leave/page.tsx", "leave requests"],
  ["hr/tasks/page.tsx", "job assignments"],
  ["crm/page.tsx", "decided enquiries"],
  ["finance/outstanding/page.tsx", "parties with a balance"],
]) {
  const src = read(`${ROOT}/${rel}`);
  ok(`${label} page`, /readPaging\(/.test(src) && /<Pager/.test(src));
}

// The one that matters most: paging must not turn a total into "the rows on
// this page". A tile that says 40 open assignments when there are 400 is worse
// than no tile.
const tasks = read(`${ROOT}/hr/tasks/page.tsx`);
ok("the open-assignments figure is counted by the database, not from the page",
  /jobAssignment\.count\(\{ where: \{ \.\.\.where, status: \{ not: "Closed" \} \} \}\)/.test(tasks));

const leave = read(`${ROOT}/hr/leave/page.tsx`);
ok("leave balances are still worked out over every employee, not the page",
  /employees\.map\(/.test(leave) && !/employees\.slice\(/.test(leave));

const crm = read(`${ROOT}/crm/page.tsx`);
ok("the pipeline board still shows every open deal — it is the closed ones that page",
  /stage: \{ notIn: \["Won", "Lost"\] \}/.test(crm) && /closedWhere/.test(crm));
ok("  and the win rate still reads every decided deal",
  /Everything, closed included, so the win rate has something to work from/.test(crm));

const jobs = read(`${ROOT}/finance/jobs/page.tsx`);
ok("job costing says why it is not paged, and opens on live jobs",
  /a page boundary through it would show a parent/.test(jobs) && /status: \{ in: \["Open", "On hold"\] \}/.test(jobs));

console.log("\n" + "=".repeat(50));
console.log(`PAGING COVERAGE:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
console.log("=".repeat(50));
if (fail > 0) process.exit(1);
