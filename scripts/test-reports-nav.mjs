/**
 * The report index and the two-level module tabs.
 *
 * The rule worth holding here is not cosmetic. Both ways into a report — the
 * Reports tab inside a module, and the Report Centre in the sidebar — read one
 * registry, so a report cannot become reachable from one and invisible from the
 * other. And a card is shown only when the visitor may open the screen behind
 * it, which is what lets the Centre have no permission of its own.
 */
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { reports, moduletabs } = await importLibs(["reports", "moduletabs"]);
const { REPORTS, REPORT_AREAS, visibleReports, groupReports, searchReports } = reports;
const { FINANCE_GROUPS, HR_GROUPS, allowedGroups, activeGroup } = moduletabs;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}${x ? "  — " + x : ""}`); };
const read = (p) => fs.readFileSync(p, "utf8");

const rbac = read("src/lib/rbac.ts");
const block = rbac.slice(rbac.indexOf("export const SCREENS"), rbac.indexOf("];", rbac.indexOf("export const SCREENS")));
const screenKeys = [...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
const screenHrefs = new Map(
  [...block.matchAll(/key:\s*"([^"]+)"[\s\S]*?href:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
);

/* ===================== the registry describes real screens =============== */

ok("every report names a screen that exists",
  REPORTS.every((r) => screenKeys.includes(r.screen)),
  REPORTS.filter((r) => !screenKeys.includes(r.screen)).map((r) => r.key).join(", ") || `${REPORTS.length} reports`);

// One screen key can guard more than one route — Trial Balance and the P&L
// both sit behind finance.reports — so comparing a card's href to that key's
// declared href proves nothing. What must be true is that the page the card
// opens really is gated by the key the card was filtered on. Otherwise the
// Report Centre could offer somebody a link that bounces them, or worse, one
// that does not bounce them when it should.
{
  const pageFor = (href) => (href === "/hr" ? "src/app/(app)/hr/page.tsx" : `src/app/(app)${href}/page.tsx`);
  const wrong = REPORTS.filter((r) => {
    const file = pageFor(r.href);
    if (!fs.existsSync(file)) return true;
    return !read(file).includes(`requireAccess("${r.screen}")`);
  });
  ok("every report card opens a page gated by the key it was filtered on",
    wrong.length === 0, wrong.map((r) => `${r.key} -> ${r.screen}`).join(", ") || `${REPORTS.length} checked`);
}

ok("report keys are unique", new Set(REPORTS.map((r) => r.key)).size === REPORTS.length);
ok("every report sits in a declared area",
  REPORTS.every((r) => REPORT_AREAS.includes(r.area)),
  REPORTS.filter((r) => !REPORT_AREAS.includes(r.area)).map((r) => r.area).join(", "));

// The question is the whole reason the index beats a list of titles. A card
// that just restates its own name teaches nobody anything.
ok("every report says what question it answers",
  REPORTS.every((r) => r.question.trim().length > 15));
ok("and the question is not merely the title again",
  REPORTS.every((r) => r.question.toLowerCase().replace(/[^a-z]/g, "") !== r.label.toLowerCase().replace(/[^a-z]/g, "")));

/* ===================== nothing is shown that cannot be opened ============ */

ok("a user with no access sees no reports", visibleReports([]).length === 0);
{
  const onlyHr = visibleReports(["hr.reports"]);
  ok("a user with one screen sees exactly the report for it", onlyHr.length === 1 && onlyHr[0].screen === "hr.reports",
    onlyHr.map((r) => r.key).join(", "));
  ok("and no finance card leaks into it", onlyHr.every((r) => r.module !== "finance"));
}
{
  const all = visibleReports(screenKeys);
  ok("an administrator sees every report", all.length === REPORTS.length, `${all.length}`);
  ok("the module filter narrows it",
    visibleReports(screenKeys, "hr").every((r) => r.module === "hr") &&
    visibleReports(screenKeys, "hr").length < all.length);
}

/* ===================== search finds it by what it does =================== */
{
  const all = visibleReports(screenKeys);
  // The point of the whole exercise: somebody who does not know the accounting
  // word for what they want should still land on the right screen.
  for (const [term, key] of [
    ["owes", "outstanding"],
    ["expire", "hr-compliance"],
    ["balance", "trial-balance"],
    ["bounced", "cheques"],
    ["budget", "jobs"],
    ["fta", "vat"],
  ]) {
    const hits = searchReports(all, term).map((r) => r.key);
    ok(`searching "${term}" finds ${key}`, hits.includes(key), hits.join(", ") || "nothing");
  }
  ok("search is case-insensitive", searchReports(all, "OWES").length === searchReports(all, "owes").length);
  ok("two words must both match", searchReports(all, "cheque bounced").length <= searchReports(all, "cheque").length);
  ok("an empty search shows everything", searchReports(all, "   ").length === all.length);
  ok("nonsense finds nothing rather than everything", searchReports(all, "zzzqqq").length === 0);
}
{
  const grouped = groupReports(visibleReports(["hr.reports"]));
  ok("empty areas are not rendered as empty headings", grouped.length === 1, `${grouped.length} areas`);
  ok("areas keep their declared order",
    groupReports(visibleReports(screenKeys)).map((g) => g.area)
      .every((a, i, arr) => i === 0 || REPORT_AREAS.indexOf(arr[i - 1]) < REPORT_AREAS.indexOf(a)));
}

/* ===================== the tabs: shorter, and still complete ============= */

ok("finance is seven groups, not sixteen tabs", FINANCE_GROUPS.length === 7, `${FINANCE_GROUPS.length}`);
ok("HR is six", HR_GROUPS.length === 6, `${HR_GROUPS.length}`);
ok("no group is longer than five screens",
  [...FINANCE_GROUPS, ...HR_GROUPS].every((g) => g.screens.length <= 5),
  [...FINANCE_GROUPS, ...HR_GROUPS].filter((g) => g.screens.length > 5).map((g) => g.key).join(", "));

// Job Costing stays its own tab: the project managers are in it daily, and a
// daily screen behind a second click is a screen people stop opening.
{
  const jobs = FINANCE_GROUPS.find((g) => g.key === "jobs");
  ok("Job Costing is a top-level tab of its own",
    !!jobs && jobs.screens.length === 1 && jobs.screens[0].href === "/finance/jobs");
}

// The reorganisation must not have lost a screen on the way.
{
  const tabbed = new Set([...FINANCE_GROUPS, ...HR_GROUPS].flatMap((g) => g.screens.map((s) => s.screen)));
  const modules = screenKeys.filter((k) => k.startsWith("finance.") || k.startsWith("hr."));
  const missing = modules.filter((k) => !tabbed.has(k));
  ok("every finance and HR screen is still on a tab", missing.length === 0, missing.join(", ") || `${modules.length} screens`);

  const hrefs = [...FINANCE_GROUPS, ...HR_GROUPS].flatMap((g) => g.screens.map((s) => s.href));
  ok("no screen is listed on two tabs", new Set(hrefs).size === hrefs.length,
    hrefs.filter((h, i) => hrefs.indexOf(h) !== i).join(", "));
}

/* ===================== the right tab lights up =========================== */
{
  const cases = [
    ["/finance", "overview"],
    ["/finance/daybook", "entry"],
    ["/finance/ledgers", "entry"],
    ["/finance/jobs", "jobs"],
    ["/finance/reports", "reports"],
    ["/finance/trial-balance", "reports"],
    ["/finance/outstanding", "reports"],
    ["/finance/cheques", "registers"],
    ["/finance/corporate-tax", "tax"],
    ["/finance/settings", "setup"],
  ];
  for (const [path, group] of cases) {
    const got = activeGroup(FINANCE_GROUPS, path);
    ok(`${path} highlights "${group}"`, got?.key === group, got?.key ?? "none");
  }
  // /finance is a prefix of every other finance path, so a naive startsWith
  // would light up Overview on every screen in the module.
  ok("Overview does not claim the whole module",
    activeGroup(FINANCE_GROUPS, "/finance/vat")?.key === "tax");
  ok("a detail page stays inside its group",
    activeGroup(HR_GROUPS, "/hr/employees/abc123")?.key === "people",
    activeGroup(HR_GROUPS, "/hr/employees/abc123")?.key ?? "none");
  ok("an unknown path highlights nothing rather than guessing",
    activeGroup(FINANCE_GROUPS, "/dashboard") === undefined);
}

/* ===================== permission filtering of the tabs ================== */
{
  const only = allowedGroups(FINANCE_GROUPS, ["finance.vat"]);
  ok("a group with nothing visible in it disappears", only.length === 1 && only[0].key === "tax",
    only.map((g) => g.key).join(", "));
  ok("and the group that remains shows only what is permitted",
    only[0].screens.length === 1 && only[0].screens[0].href === "/finance/vat");
  ok("no permissions means no tabs at all", allowedGroups(FINANCE_GROUPS, []).length === 0);
  ok("a group tab lands on the first screen the user may actually open",
    allowedGroups(FINANCE_GROUPS, ["finance.retention"])[0].screens[0].href === "/finance/retention");
}

/* ===================== how it is wired in =============================== */
{
  const tabs = read("src/components/ModuleTabsClient.tsx");
  ok("the second row appears only when a group holds more than one screen",
    /current.screens.length > 1 \? current.screens : \[\]/.test(tabs));
  ok("the company id still travels with every tab",
    /href=\{`\$\{g\.screens\[0\]\.href\}\$\{q\}`\}/.test(tabs) && /href=\{`\$\{s\.href\}\$\{q\}`\}/.test(tabs),
    "otherwise switching tabs silently switches company");
  ok("both rows are kept off the paper", /print:hidden/.test(tabs));
  ok("there is a way through to every report from inside a module",
    tabs.includes('href="/reports"'));

  ok("the old per-module tab lists are gone",
    !fs.existsSync("src/components/FinanceTabsClient.tsx") && !fs.existsSync("src/components/HrTabsClient.tsx"));
  for (const f of ["src/components/FinanceTabs.tsx", "src/components/HrTabs.tsx"]) {
    ok(`${f.split("/").pop()} still exists, so no page had to change`, fs.existsSync(f));
    ok("and it filters by permission on the server", read(f).includes("visibleScreens"));
  }

  const page = read("src/app/(app)/reports/page.tsx");
  ok("the Report Centre filters by what the user may view", /visibleReports\(allowed\)/.test(page));
  ok("it passes only the keys, not the whole registry, to the browser",
    /keys=\{mine\.map\(\(r\) => r\.key\)\}/.test(page));
  const data = read("src/lib/data.ts");

  // Deliberately NOT in the sidebar. Finance and HR each have a Reports tab of
  // their own, and a third menu entry answering to the same word was one more
  // than the word can carry. The only way in is the link at the end of the
  // module tab strip, which makes that link load-bearing rather than a
  // convenience — so it is asserted here as well as above.
  ok("the Report Centre is not a sidebar entry", !data.includes('href: "/reports"'));
  ok("and the machinery only it used went with it",
    !data.includes("requiresAny") && !read("src/components/Sidebar.tsx").includes("requiresAny"));
  ok("the module tab strip is the way in", tabs.includes('href="/reports"'));
  ok("the link reads as the superset of this module's own Reports tab",
    /All reports/.test(tabs) && read("src/lib/moduletabs.ts").includes('label: "Reports"'));
  ok("the page still says what it is",
    read("src/app/(app)/reports/page.tsx").includes('title="All Reports"'));

  // The help used to say "click Reports in the left menu", where it no longer is.
  const help = read("src/lib/help.ts");
  ok("and there is plain-English help for finding a report",
    /id: "reports-centre"/.test(help));
  ok("which describes the route that actually exists",
    /Open Finance or HR, and click 'All reports'/.test(help) &&
    !/Click Reports in the left menu/.test(help));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
