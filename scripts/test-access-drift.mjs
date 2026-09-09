/**
 * Access control must not drift from the screens that exist.
 *
 * There are three lists that have to agree, and nothing made them:
 *   - SCREENS in src/lib/rbac.ts, the permission keys
 *   - the routes under src/app/(app), the things a user can open
 *   - MODULE_SCREENS in prisma/seed.mjs, what each role is granted
 *
 * They fell out of step once already: finance.jobs, finance.parties and
 * finance.outstanding existed and were gated, but were never granted to any
 * finance role, so only the admin roles — which bypass the list entirely —
 * could open them. Nobody noticed because the people testing were admins.
 *
 * This fails at development time instead.
 */
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};

/* ---------------------------------------------------- the declared keys -- */
const rbac = read("src/lib/rbac.ts");
const block = rbac.slice(rbac.indexOf("export const SCREENS"), rbac.indexOf("];", rbac.indexOf("export const SCREENS")));
const screens = [...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
ok("the screen list is readable", screens.length > 20, `${screens.length} screens`);

/* ---------------------------------------------------------- the routes -- */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
};
const pages = walk("src/app/(app)");

// Open to anyone signed in, on purpose.
const OPEN = new Set([
  "src/app/(app)/account/page.tsx",
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/help/page.tsx",
  "src/app/(app)/notifications/page.tsx",
  // The Report Centre lists only reports whose own screens the visitor may
  // already open, so a separate grant would add nothing but a way to be locked
  // out of a directory of things you can already reach.
  "src/app/(app)/reports/page.tsx",
]);

const ungated = pages.filter((p) => !OPEN.has(p) && !read(p).includes("requireAccess("));
ok("every screen is gated, or deliberately open", ungated.length === 0,
  ungated.length ? ungated.join(", ") : `${pages.length} screens checked`);

const used = new Set();
for (const p of pages) {
  const m = read(p).match(/requireAccess\("([^"]+)"/);
  if (m) used.add(m[1]);
}
const unknown = [...used].filter((k) => !screens.includes(k));
ok("every key a screen asks for is a declared screen", unknown.length === 0, unknown.join(", "));

/* ------------------------------------------------ what roles are granted - */
const seed = read("prisma/seed.mjs");
const modBlock = seed.slice(seed.indexOf("const MODULE_SCREENS"), seed.indexOf("};", seed.indexOf("const MODULE_SCREENS")));
const granted = new Set([...modBlock.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]));
ok("the seed's grant list is readable", granted.size > 20, `${granted.size} keys`);

// A screen nobody can be granted is a screen only an administrator can open,
// which is how three finance screens quietly became admin-only.
const ungrantable = screens.filter((k) => !granted.has(k));
ok("every declared screen can be granted to a role", ungrantable.length === 0,
  ungrantable.length ? `not grantable: ${ungrantable.join(", ")}` : `${screens.length} checked`);

// And the reverse: a grant for a screen that no longer exists is dead config.
const stale = [...granted].filter((k) => !screens.includes(k));
ok("no role is granted a screen that does not exist", stale.length === 0, stale.join(", "));

/* --------------------------------------- the tabs point at real screens -- */
// Both modules' tab groups live in one file now, and the report index reads
// the same screen keys, so a renamed screen has three places to break and this
// is the one that notices.
for (const [file, label] of [
  ["src/lib/moduletabs.ts", "module tab"],
  ["src/lib/reports.ts", "report card"],
]) {
  if (!fs.existsSync(file)) continue;
  const tabKeys = [...read(file).matchAll(/screen:\s*"([^"]+)"/g)].map((m) => m[1]);
  const bad = tabKeys.filter((k) => !screens.includes(k));
  ok(`every ${label} names a declared screen`, bad.length === 0, bad.join(", ") || `${tabKeys.length} checked`);
}

// A screen nobody can navigate to is a screen nobody uses. Settings-only and
// detail pages are reached from elsewhere; the rest must be on a tab.
{
  const tabbed = new Set([...read("src/lib/moduletabs.ts").matchAll(/screen:\s*"([^"]+)"/g)].map((m) => m[1]));
  // Everywhere a person can be handed a link: the sidebar, the module tabs,
  // and the Settings hub, which is the only landing page that navigates onward.
  const nav = read("src/lib/data.ts") + read("src/app/(app)/settings/page.tsx");
  // key and href travel together on each SCREENS entry, so read them as a pair.
  const pairs = [...block.matchAll(/key:\s*"([^"]+)"[\s\S]*?href:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
  const orphans = pairs.filter(([key, href]) => !tabbed.has(key) && !nav.includes(`"${href}"`)).map(([k]) => k);
  ok("every screen is reachable from a menu or a tab", orphans.length === 0,
    orphans.join(", ") || `${pairs.length} checked`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
