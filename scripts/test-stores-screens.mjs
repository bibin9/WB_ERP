/**
 * The stores screens, and the wiring behind them.
 *
 * The module is four screens and they only earn their place if they are
 * reachable, guarded, and honest about what they are doing to the accounts.
 * The accounting itself is exercised in test-stock-posting; this covers the
 * parts that only exist in the browser.
 */
import fs from "node:fs";
import { importLibs } from "./lib-shim.mjs";

const { rbac, moduletabs, reports } = await importLibs(["rbac", "moduletabs", "reports"]);
const { SCREENS } = rbac;
const { INVENTORY_GROUPS, FINANCE_GROUPS, HR_GROUPS, allowedGroups, activeGroup } = moduletabs;
const { REPORTS, REPORT_AREAS } = reports;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const read = (p) => fs.readFileSync(p, "utf8");

/* ================================================= every screen exists === */

const SCREEN_FILES = {
  "inventory.items": "src/app/(app)/inventory/page.tsx",
  "inventory.stock": "src/app/(app)/inventory/stock/page.tsx",
  "inventory.movements": "src/app/(app)/inventory/movements/page.tsx",
  "inventory.stores": "src/app/(app)/inventory/stores/page.tsx",
  "inventory.requests": "src/app/(app)/inventory/requests/page.tsx",
  "inventory.orders": "src/app/(app)/inventory/orders/page.tsx",
};

for (const [key, file] of Object.entries(SCREEN_FILES)) {
  const screen = SCREENS.find((s) => s.key === key);
  ok(`${key} is registered`, !!screen, screen?.href);
  ok(`  and its page exists`, fs.existsSync(file), file);

  const src = read(file);
  ok(`  it guards itself`, new RegExp(`requireAccess\\("${key}"\\)`).test(src),
    "a screen that does not ask is a screen anybody can open");
  ok(`  and renders its tab strip`, /<InventoryTabs/.test(src), "otherwise it is a dead end");
}

// The stub said phase 2. It is phase 2, so nothing should still say so.
for (const file of Object.values(SCREEN_FILES)) {
  ok(`${file.split("/").pop()} is built, not a placeholder`, !/ComingSoon/.test(read(file)));
}

/* ==================================================== the tabs are sane == */

ok("the module has a tab set", INVENTORY_GROUPS.length > 0);
ok("no group is longer than five screens",
  INVENTORY_GROUPS.every((g) => g.screens.length <= 5));
ok("every tab points at a registered screen",
  INVENTORY_GROUPS.every((g) => g.screens.every((s) => SCREENS.some((k) => k.key === s.screen))));
ok("and at the href that screen actually has",
  INVENTORY_GROUPS.every((g) =>
    g.screens.every((s) => SCREENS.find((k) => k.key === s.screen)?.href === s.href)));

// Every screen in the module is reachable from the strip, or it is a screen
// nobody will ever find.
{
  const tabbed = new Set(INVENTORY_GROUPS.flatMap((g) => g.screens.map((s) => s.screen)));
  const registered = SCREENS.filter((s) => s.module === "inventory").map((s) => s.key);
  const missing = registered.filter((k) => !tabbed.has(k));
  ok("every inventory screen is on the strip", missing.length === 0, missing.join(", "));
}

/**
 * A storekeeper who may only receive and issue should still get a usable strip,
 * not an empty bar or somebody else's screens.
 */
{
  const narrow = allowedGroups(INVENTORY_GROUPS, ["inventory.movements"]);
  ok("a restricted role keeps the tabs it may open", narrow.length === 1);
  ok("  and loses the ones it may not", narrow[0].screens[0].screen === "inventory.movements");
  ok("no access leaves no strip at all", allowedGroups(INVENTORY_GROUPS, []).length === 0);
}

ok("the active tab is found from the path",
  activeGroup(INVENTORY_GROUPS, "/inventory/stock")?.key === "stock");
ok("  and the items screen does not swallow its siblings",
  activeGroup(INVENTORY_GROUPS, "/inventory/movements")?.key === "movements",
  "/inventory is a prefix of every other path in the module");

/* ================================================= the report centre ==== */
{
  const card = REPORTS.find((r) => r.key === "stock");
  ok("stock on hand has a card in the report centre", !!card);
  ok("  in a declared area", !!card && REPORT_AREAS.includes(card.area), card?.area);
  ok("  asking a question rather than naming itself",
    !!card && /\?$/.test(card.question), card?.question);
}

/* =========================================== the accounting is honest === */

const movements = read("src/app/(app)/inventory/movements/page.tsx");
ok("the movements screen says an asset is not a cost",
  /asset, not a cost/.test(movements),
  "the one thing somebody has to understand before using it");
ok("  and why a transfer posts nothing",
  /changes where the stock\s*\n?\s*is, not what the company owns/.test(movements) ||
  /not what the company owns/.test(movements));
ok("  and that nothing can be edited", /a correction is a new movement/.test(movements));

const stock = read("src/app/(app)/inventory/stock/page.tsx");
ok("the stock screen explains its valuation", /weighted average/.test(stock));
ok("  and that the balance is summed, not stored",
  /summed from the movements/.test(stock));
ok("  it warns loudly about a negative balance", /less than nothing in stock/.test(stock));

const actions = read("src/app/(app)/inventory/actions.ts");
ok("the screens delegate the accounting rather than reimplement it",
  /from "@\/lib\/stock-posting"/.test(actions),
  "so the rules are tested against a database, not read as text");
ok("an item with history cannot be deleted", /Deactivate it instead/.test(actions));
ok("nor quietly turned into a non-stocked one",
  /cannot be changed to a non-stocked item/.test(actions),
  "the shelf would keep a balance nothing could ever move");

/* ================================================= plain-English help === */

const help = read("src/lib/help.ts");
for (const id of ["stores-items", "stores-stock", "stores-movements", "stores-material-on-jobs"]) {
  ok(`there is help for ${id}`, new RegExp(`id: "${id}"`).test(help));
}
ok("the Stores category is declared", /"Stores",/.test(help.slice(0, help.indexOf("HELP_ARTICLES"))));
ok("the help says how material reaches a job",
  /Issuing from the store is what puts material cost on a contract/.test(help));

/* ======================================== the roles that need it have it = */
{
  // Read the whole block, not one line of it: the grant outgrew a single
  // line the moment there were more than four screens, and a line-based
  // check would have quietly stopped seeing the ones that came after.
  const seed = read("prisma/seed.mjs");
  const from = seed.indexOf("inventory: [");
  const block = seed.slice(from, seed.indexOf("]", from));
  const granted = [...block.matchAll(/inventory\.(\w+)/g)].map((m) => m[1]);
  const registered = SCREENS.filter((s) => s.module === "inventory").map((s) => s.key.split(".")[1]);
  const missing = registered.filter((k) => !granted.includes(k));

  ok("the seed grants every inventory screen, not just the first",
    missing.length === 0,
    missing.length ? `not granted: ${missing.join(", ")}` : granted.join(", "));
  ok("  and grants nothing that does not exist",
    granted.every((g) => registered.includes(g)),
    "a grant for a screen nobody built is a permission nothing can ever check");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
