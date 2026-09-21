/**
 * Built-in roles: defaults applied once, administrators' changes kept, and
 * every role named on an approval route able to approve.
 *
 * Two defects this guards. The seed wrote every built-in role's permissions
 * and approval level from its defaults on every boot, so any change made in
 * Access Control was undone at the next deploy. And the Material Request and
 * Purchase Order routes named the Project Manager, Site Engineer and
 * Procurement Officer, whose roles could not approve in the inbox — their
 * Approve button did nothing, and only more senior people could move work.
 */
import fs from "node:fs";
import { mergeRoleDefaults } from "../prisma/role-defaults.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? "  — " + extra : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "  — " + extra : ""}`); }
};
const P = (json) => JSON.parse(json);

/* --------------------------------------------------------- the merge -- */
const defaults = { "inventory.items": ["view", "create"], "approvals.inbox": ["view", "approve"] };

const fresh = mergeRoleDefaults("{}", "{}", defaults);
ok("a new role gets its defaults", JSON.stringify(P(fresh.permissions)["inventory.items"]) === '["view","create"]' && P(fresh.permissions)["approvals.inbox"].includes("approve"));
ok("  and records them as applied", JSON.stringify(P(fresh.seeded)) === JSON.stringify(defaults));

// An administrator removes approve, and removes the items screen entirely.
const edited = JSON.stringify({ "approvals.inbox": ["view"] });
const again = mergeRoleDefaults(edited, fresh.seeded, defaults);
ok("an action an administrator removed stays removed", !P(again.permissions)["approvals.inbox"].includes("approve"));
ok("a screen an administrator removed stays removed", !("inventory.items" in P(again.permissions)));
ok("  and nothing is reported as granted", again.added.length === 0, again.added.join(", ") || "none");

// A screen added to the system after the role was created.
const later = { ...defaults, "inventory.returns": ["view"] };
const upgraded = mergeRoleDefaults(edited, fresh.seeded, later);
ok("a screen new to the defaults reaches the role", JSON.stringify(P(upgraded.permissions)["inventory.returns"]) === '["view"]');
ok("  without restoring what the administrator removed", !("inventory.items" in P(upgraded.permissions)) && !P(upgraded.permissions)["approvals.inbox"].includes("approve"));
ok("  and it says what it granted", upgraded.added.join(",") === "inventory.returns.view", upgraded.added.join(", "));

// A new action on a screen the role already had.
const moreActions = mergeRoleDefaults(JSON.stringify({ "inventory.items": ["view"] }), JSON.stringify({ "inventory.items": ["view"] }), { "inventory.items": ["view", "edit"] });
ok("a new action on an existing screen is added", P(moreActions.permissions)["inventory.items"].includes("edit"));

// Something the administrator added beyond the defaults.
const extra = mergeRoleDefaults(JSON.stringify({ "finance.daybook": ["view"], "approvals.inbox": ["view", "approve"] }), fresh.seeded, defaults);
ok("access an administrator added beyond the defaults is kept", JSON.stringify(P(extra.permissions)["finance.daybook"]) === '["view"]');

ok("damaged stored JSON is treated as empty rather than crashing the boot",
  (() => { try { return P(mergeRoleDefaults("not json", "[1,2]", defaults).permissions)["approvals.inbox"].length === 2; } catch { return false; } })());

// An install from before this change: permissions equal the defaults (the old
// seed rewrote them every boot) and nothing has been recorded as applied.
const legacy = mergeRoleDefaults(fresh.permissions, "{}", defaults);
ok("an install from before the change keeps its permissions exactly", legacy.permissions === fresh.permissions && legacy.added.length === 0);

/* ---------------------------------------- withdrawing what it granted -- */
// September 2026: roles were narrowed, and adding alone could never take the
// old grants back. What the seed applied and no longer applies is withdrawn;
// what an administrator granted by hand is not.
{
  const was = { "hr.payroll": ["view"], "hr.attendance": ["view"] };
  const now = { "hr.attendance": ["view"] };
  const first = mergeRoleDefaults("{}", "{}", was);
  const narrowed = mergeRoleDefaults(first.permissions, first.seeded, now);
  ok("a right the seed granted and no longer grants is withdrawn", !("hr.payroll" in P(narrowed.permissions)) && narrowed.removed.join(",") === "hr.payroll.view", narrowed.removed.join(", "));
  ok("  and forgotten, so it is not re-added or re-withdrawn", !("hr.payroll" in P(narrowed.seeded)) && mergeRoleDefaults(narrowed.permissions, narrowed.seeded, now).removed.length === 0);
  ok("  what is still a default stays", JSON.stringify(P(narrowed.permissions)["hr.attendance"]) === '["view"]');

  const byHand = JSON.stringify({ ...P(first.permissions), "finance.daybook": ["view"] });
  ok("a right an administrator granted by hand is never withdrawn",
    JSON.stringify(P(mergeRoleDefaults(byHand, first.seeded, now).permissions)["finance.daybook"]) === '["view"]');

  const handEdit = JSON.stringify({ ...P(first.permissions), "hr.payroll": ["view", "edit"] });
  const kept = P(mergeRoleDefaults(handEdit, first.seeded, now).permissions)["hr.payroll"];
  ok("an action an administrator added keeps its screen visible", JSON.stringify(kept) === '["view","edit"]', JSON.stringify(kept));

  // An install from before seededPermissions: the old seed wrote everything.
  const legacyBroad = JSON.stringify({ "hr.payroll": ["view"], "hr.attendance": ["view"] });
  const upgraded = mergeRoleDefaults(legacyBroad, "{}", now);
  ok("an install from before the record loses the old broad grants too", !("hr.payroll" in P(upgraded.permissions)) && upgraded.removed.includes("hr.payroll.view"));
}

/* ------------------------------------------------- the seed as written -- */
const seed = fs.readFileSync("prisma/seed.mjs", "utf8");
ok("the seed no longer writes permissions or approval level over an existing role",
  !/update:\s*\{\s*approvalLevel:\s*r\.approvalLevel,\s*permissions\s*\}/.test(seed) && seed.includes("mergeRoleDefaults(existing.permissions, existing.seededPermissions"));

// Every role an approval route names must hold approve on the inbox, or be one
// of the director-level roles that hold everything.
const roleLines = [...seed.matchAll(/\{ name: "([^"]+)", approvalLevel: (\d+), permissions: \{([^}]*)\} \}/g)];
const roles = Object.fromEntries(roleLines.map(([, name, level, perms]) => [name, { level: Number(level), perms }]));
const routesBlock = seed.slice(seed.indexOf("const ROUTES = {"), seed.indexOf("};", seed.indexOf("const ROUTES = {")));
const routeRoles = [...new Set([...routesBlock.matchAll(/role: "([^"]+)"/g)].map((m) => m[1]))];
ok("the seed's roles and routes are readable", Object.keys(roles).length >= 10 && routeRoles.length >= 4, `${Object.keys(roles).length} roles, ${routeRoles.length} route roles`);
const cannot = routeRoles.filter((name) => {
  const r = roles[name];
  if (!r) return true;
  if (r.level >= 80) return false; // director-level roles are granted everything
  return !/approvals: \[[^\]]*"approve"/.test(r.perms);
});
ok("every role named on an approval route can approve in the inbox", cannot.length === 0, cannot.join(", ") || routeRoles.join(", "));

/* --------------------------------------------- refusing out loud -- */
const actions = fs.readFileSync("src/app/(app)/approvals/actions.ts", "utf8");
const decide = actions.slice(actions.indexOf("export async function decideStep"));
ok("a refused approval says why instead of doing nothing",
  decide.includes("not approve them") && !/allow\("approvals\.inbox", "approve"\)\)\) return;/.test(decide));
ok("the inbox tells somebody without the grant, rather than offering buttons",
  fs.readFileSync("src/app/(app)/approvals/page.tsx", "utf8").includes('can(session, "approvals.inbox", "approve")'));

/* ------------------------ each tester's role can do what its checks ask -- */
// Setting up the business acceptance testers (September 2026) found six checks
// handed to a role without the right to do them: Accounts could draft invoices
// but not issue them, the estimator could not issue an approved quotation or
// record the order, and the Finance Controller could not lock a period. Each
// tester would have recorded a failure that was really a missing grant.
{
  const start = seed.indexOf("const V = ");
  const end = seed.indexOf("];", seed.indexOf("const ROLES = [")) + 2;
  const { ROLES, expandPerms } = new Function(seed.slice(start, end) + "\nreturn { ROLES, expandPerms };")();
  const rights = (name) => expandPerms(ROLES.find((r) => r.name === name)?.permissions ?? {});
  const NEEDS = [
    ["Finance / Accounts", "finance.invoices", "approve", "FIN-02, FIN-03, FIN-07 — issue an invoice, a credit note, a reverse-charge bill"],
    ["Estimation / Sales Engineer", "crm.quotations", "approve", "EST-09 — issue the approved quotation; EST-11 — record the customer's order"],
    ["Estimation / Sales Engineer", "crm.quotations", "create", "EST-07, EST-10 — raise and revise a quotation"],
    ["Finance Controller", "finance.settings", "approve", "FC-03 — lock a period from Finance → Setup"],
    ["Storekeeper", "inventory.movements", "create", "STR-01, STR-05 — receive and issue"],
    ["QA/QC & Calibration", "inventory.movements", "edit", "QA-01, QA-02 — pass or fail a delivery"],
    ["Procurement Officer", "inventory.rfq", "approve", "PRC-06 — award an enquiry"],
    ["HR Officer", "hr.payroll", "create", "HR-03 — run payroll"],
    ["Finance Controller", "hr.payroll", "approve", "FC-06 — approve the payroll run HR prepared"],
    ["Site Timekeeper", "hr.attendance", "create", "TK-01 — record the day's muster"],
    ["Project Manager", "inventory.requests", "create", "PM-03 — raise a material request"],
    ["Site Engineer / Planner", "inventory.requests", "create", "SITE-01 — ask for material"],
    ["Storekeeper", "inventory.orders", "view", "STR-01 — open the order to receive against it"],
    ["Storekeeper", "inventory.returns", "create", "STR-09 — take material back from site"],
    ["Procurement Officer", "inventory.orders", "create", "PRC-07, PRC-09 — raise purchase orders"],
    ["QA/QC & Calibration", "inventory.equipment", "edit", "QA-03, QA-04 — calibrate and edit tools"],
    ["Site Engineer / Planner", "approvals.inbox", "approve", "SITE-03 — approve a material request"],
    ["Project Manager", "approvals.inbox", "approve", "PM-01, PM-02 — approve requests and orders"],
  ];
  for (const [role, screen, action, why] of NEEDS) {
    ok(`${role} can ${action} on ${screen}`, (rights(role)[screen] ?? []).includes(action), why);
  }
  // The code must ask for exactly those rights, or the grant proves nothing.
  const read = (p) => fs.readFileSync(p, "utf8");
  ok("issuing an invoice is gated on Approve on Invoices", /allowIn\(existing\.companyId, "finance\.invoices", "approve"\)/.test(read("src/app/(app)/finance/invoices/actions.ts")));
  ok("issuing a quotation and recording the order are gated on Approve on Quotations",
    (read("src/app/(app)/crm/quotations/actions.ts").match(/allow\("crm\.quotations", "approve"\)/g) ?? []).length >= 2);
  const lock = read("src/app/(app)/finance/settings/actions.ts");
  const setLock = lock.slice(lock.indexOf("export async function setBooksLock"));
  ok("the period lock is gated on Approve on Finance Settings, for the user's own company",
    /allowIn\(companyId, "finance\.settings", "approve"\)/.test(setLock));
  ok("  a lock on a future date is refused, and every change is audited",
    /lockTo\.getTime\(\) > Date\.now\(\)/.test(setLock) && /await audit\(/.test(setLock));

  /* ------------------------ least privilege and separation of duties -- */
  // The September 2026 access review: whole-module grants had grown with every
  // screen added, so a Site Engineer could read every salary. These hold the
  // narrowed roles to it.
  const scoped = ROLES.filter((r) => r.approvalLevel < 80 && r.name !== "Group Admin");
  const holders = (screen, action = "view") => scoped.filter((r) => (rights(r.name)[screen] ?? []).includes(action)).map((r) => r.name).sort();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());

  ok("salaries and profiles (Employees) are for HR only", eq(holders("hr.employees"), ["HR Officer"]), holders("hr.employees").join(", "));
  ok("payroll is for HR and the Finance Controller only", eq(holders("hr.payroll"), ["HR Officer", "Finance Controller"]), holders("hr.payroll").join(", "));
  ok("end-of-service settlements are for HR only", eq(holders("hr.separation"), ["HR Officer"]), holders("hr.separation").join(", "));
  ok("leave, onboarding and the HR policy are for HR only",
    ["hr.leave", "hr.onboarding", "hr.policy"].every((s) => eq(holders(s), ["HR Officer"])));

  const both = (a, b) => scoped.filter((r) => { const p = rights(r.name); return (p[a[0]] ?? []).includes(a[1]) && (p[b[0]] ?? []).includes(b[1]); }).map((r) => r.name);
  ok("nobody below director both orders and receives", both(["inventory.orders", "create"], ["inventory.movements", "create"]).length === 0,
    both(["inventory.orders", "create"], ["inventory.movements", "create"]).join(", ") || "none");
  ok("nobody below director both receives and passes inspection", both(["inventory.movements", "create"], ["inventory.movements", "edit"]).length === 0,
    both(["inventory.movements", "create"], ["inventory.movements", "edit"]).join(", ") || "none");
  ok("nobody below director both prepares and approves payroll", both(["hr.payroll", "create"], ["hr.payroll", "approve"]).length === 0,
    both(["hr.payroll", "create"], ["hr.payroll", "approve"]).join(", ") || "none");
  ok("only the Finance Controller changes finance settings, Tally and corporate tax",
    ["finance.settings", "finance.tally", "finance.corptax"].every((s) => eq(holders(s, "edit"), ["Finance Controller"])));
  ok("the Site Timekeeper has attendance and a landing page, nothing else",
    JSON.stringify(rights("Site Timekeeper")) === JSON.stringify({ "dashboard.home": ["view"], "hr.attendance": ["view", "create", "edit"] }),
    JSON.stringify(rights("Site Timekeeper")));
  ok("every built-in role is granted screens, never a whole module",
    scoped.every((r) => !Object.keys(r.permissions).some((k) => ["hr", "inventory"].includes(k))
      || ["Operations Manager", "HR Officer"].includes(r.name)),
    "hr/inventory module grants only where the whole module is meant: Operations Manager (inventory view/approve), HR Officer (hr)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
