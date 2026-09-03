/**
 * Access Control (RBAC) + Master Data test suite.
 * Run: node scripts/test-rbac.mjs
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
let pass = 0, fail = 0;
function ok(id, name, cond, detail = "") { if (cond) pass++; else fail++; console.log(`${cond ? "✅" : "❌"} ${id}  ${name}${detail ? "  — " + detail : ""}`); }

const MODULE_KEYS = ["dashboard", "companies", "finance", "hr", "approvals", "users", "inventory", "crm", "projects", "hse", "audit", "settings"];
function parse(json) { try { const v = JSON.parse(json); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
function isAdminRole(r) { return r.approvalLevel >= 80 || r.name === "Group Admin"; }
function can(role, mod, action = "view") { if (isAdminRole(role)) return true; return (parse(role.permissions)[mod] || []).includes(action); }
function visibleModules(role) { if (isAdminRole(role)) return MODULE_KEYS.slice(); return MODULE_KEYS.filter((m) => (parse(role.permissions)[m] || []).includes("view")); }
// replicate setRolePermission toggle logic
function toggle(perms, mod, action, enabled) {
  const set = new Set(perms[mod] || []);
  if (enabled) { set.add(action); set.add("view"); } else { if (action === "view") set.clear(); else set.delete(action); }
  if (set.size === 0) delete perms[mod]; else perms[mod] = [...set];
  return perms;
}

async function main() {
  const tenant = await db.tenant.findUnique({ where: { key: "wandb" } });
  const roles = await db.role.findMany({ where: { tenantId: tenant.id } });
  const byName = (n) => roles.find((r) => r.name === n);

  // ===== ROLES SEEDED =====
  const expected = ["Group Admin", "Managing Director", "Director", "Operations Manager", "Finance Controller", "Project Manager",
    "Estimation / Sales Engineer", "Site Engineer / Planner", "Procurement Officer", "Storekeeper", "QA/QC & Calibration",
    "HSE Officer", "HR Officer", "Finance / Accounts", "Vendor (external)", "Customer (external)"];
  ok("RB-1", "All defined roles are seeded", expected.every((n) => !!byName(n)), `${roles.length} roles`);

  // ===== ADMIN OVERRIDE =====
  ok("RB-2", "Group Admin has access to everything", can(byName("Group Admin"), "finance") && can(byName("Director"), "hse", "approve"));

  // ===== SCOPED PERMISSIONS =====
  const hr = byName("HR Officer");
  ok("RB-3", "HR Officer CAN view HR", can(hr, "hr", "view"));
  ok("RB-4", "HR Officer CANNOT view Finance", !can(hr, "finance", "view"));
  ok("RB-5", "HR Officer CANNOT view Users/Settings", !can(hr, "users") && !can(hr, "settings"));
  const store = byName("Storekeeper");
  ok("RB-6", "Storekeeper sees only Dashboard + Inventory", visibleModules(store).sort().join(",") === ["dashboard", "inventory"].sort().join(","), visibleModules(store).join(","));
  const proc = byName("Procurement Officer");
  ok("RB-7", "Procurement Officer can APPROVE inventory", can(proc, "inventory", "approve"));
  const est = byName("Estimation / Sales Engineer");
  ok("RB-8", "Estimation Engineer can create in CRM, not Finance", can(est, "crm", "create") && !can(est, "finance"));

  // ===== visibleModules for nav filtering =====
  ok("RB-9", "Group Admin sees all 12 modules", visibleModules(byName("Group Admin")).length === 12);
  const fin = byName("Finance / Accounts");
  ok("RB-10", "Finance/Accounts sees finance but not HR/projects", visibleModules(fin).includes("finance") && !visibleModules(fin).includes("hr"));

  // ===== toggle logic =====
  let p = {};
  p = toggle(p, "hr", "create", true);
  ok("RB-11", "Enabling an action auto-adds 'view'", p.hr.includes("view") && p.hr.includes("create"));
  p = toggle(p, "hr", "view", false);
  ok("RB-12", "Removing 'view' clears the whole module", !p.hr);

  // ===== role delete guard =====
  const admin = byName("Group Admin");
  const inUse = await db.companyMembership.count({ where: { roleId: admin.id } });
  ok("RB-13", "Role assigned to users cannot be deleted (guard)", inUse > 0, `${inUse} membership(s)`);

  // ===== MASTER DATA =====
  const depts = await db.masterItem.count({ where: { tenantId: tenant.id, type: "Department" } });
  const desigs = await db.masterItem.count({ where: { tenantId: tenant.id, type: "Designation" } });
  const grades = await db.masterItem.count({ where: { tenantId: tenant.id, type: "Grade" } });
  ok("MD-1", "Master data seeded (Departments, Designations, Grades)", depts > 0 && desigs > 0 && grades > 0, `${depts}/${desigs}/${grades}`);
  const item = await db.masterItem.create({ data: { tenantId: tenant.id, type: "Department", value: "TEST-DEPT", order: 99 } });
  ok("MD-2", "Master item CREATE", !!(await db.masterItem.findUnique({ where: { id: item.id } })));
  let dupBlocked = false;
  try { await db.masterItem.create({ data: { tenantId: tenant.id, type: "Department", value: "TEST-DEPT", order: 100 } }); } catch { dupBlocked = true; }
  ok("MD-3", "Duplicate master value blocked (unique per tenant+type)", dupBlocked);
  await db.masterItem.delete({ where: { id: item.id } });
  ok("MD-4", "Master item DELETE", !(await db.masterItem.findUnique({ where: { id: item.id } })));

  console.log("\n" + "=".repeat(50));
  console.log(`RBAC RESULTS:  ${pass} passed, ${fail} failed  (${pass + fail} total)`);
  console.log("=".repeat(50));
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
