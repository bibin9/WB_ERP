"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { ACTIONS, SCREENS, parsePerms, screensForModule } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { cleanLevel, levelOf, outranks, OUTRANKED } from "@/lib/rank";

type Result = { ok: boolean; error?: string };

/**
 * An administrator, and their level. Every change below also needs the role
 * being changed to sit below that level (lib/rank.ts) — otherwise a Director
 * could add screens to their own role, or raise it above the Group Admin.
 */
async function guard() {
  const session = await getSession();
  if (!session || !(await canAdminister())) return null;
  return { ...session, level: levelOf(session.companies.map((c) => c.approvalLevel)) };
}

const KNOWN_ACTIONS = new Set<string>(ACTIONS);
const KNOWN_SCREENS = new Set(SCREENS.map((s) => s.key));

export async function createRole(formData: FormData): Promise<Result> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  const name = String(formData.get("name") || "").trim().slice(0, 80);
  const approvalLevel = cleanLevel(formData.get("approvalLevel") || 0);
  if (!name) return { ok: false, error: "Give the role a name." };
  if (approvalLevel === null) return { ok: false, error: "The level must be a whole number from 0 to 100." };
  if (!outranks(session.level, approvalLevel)) return { ok: false, error: OUTRANKED };
  const exists = await db.role.findUnique({ where: { tenantId_name: { tenantId: session.tenant.id, name } } });
  if (exists) return { ok: false, error: "There is already a role with that name." };
  await db.role.create({ data: { tenantId: session.tenant.id, name, approvalLevel, permissions: "{}" } });
  await audit({ action: "Created", entity: "Role", summary: `Created role ${name} (L${approvalLevel})` });
  revalidatePath("/settings/roles");
  return { ok: true };
}

export async function updateRoleLevel(roleId: string, level: number): Promise<Result> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  const next = cleanLevel(level);
  if (next === null) return { ok: false, error: "The level must be a whole number from 0 to 100." };
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "Not found" };
  if (!outranks(session.level, role.approvalLevel) || !outranks(session.level, next)) return { ok: false, error: OUTRANKED };
  await db.role.update({ where: { id: roleId }, data: { approvalLevel: next } });
  await audit({ action: "Updated", entity: "Role", entityId: roleId, summary: `Changed ${role.name} level L${role.approvalLevel} to L${next}` });
  revalidatePath("/settings/roles");
  return { ok: true };
}

/** Apply an action toggle to one permission key (screen). Adding any action auto-adds "view"; removing "view" clears the screen. */
function applyToggle(perms: ReturnType<typeof parsePerms>, key: string, action: string, enabled: boolean) {
  const set = new Set(perms[key] || []);
  if (enabled) {
    set.add(action);
    set.add("view"); // any capability implies view
  } else {
    if (action === "view") set.clear();
    else set.delete(action);
  }
  if (set.size === 0) delete perms[key];
  else perms[key] = Array.from(set);
}

/** Toggle one permission on a single screen (screen × action). */
export async function setRolePermission(roleId: string, screenKey: string, action: string, enabled: boolean): Promise<Result> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  if (!KNOWN_SCREENS.has(screenKey) || !KNOWN_ACTIONS.has(action)) return { ok: false, error: "Unknown screen or action" };
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "Not found" };
  if (!outranks(session.level, role.approvalLevel)) return { ok: false, error: OUTRANKED };
  const perms = parsePerms(role.permissions);
  applyToggle(perms, screenKey, action, enabled);
  await db.role.update({ where: { id: roleId }, data: { permissions: JSON.stringify(perms) } });
  await audit({ action: "Updated", entity: "Role", entityId: roleId, summary: `Changed ${role.name} access: ${screenKey}.${action} = ${enabled}` });
  revalidatePath("/settings/roles");
  return { ok: true };
}

/** Toggle an action across every screen in a module at once (the module header "All" control). */
export async function setModulePermission(roleId: string, moduleKey: string, action: string, enabled: boolean): Promise<Result> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  if (!KNOWN_ACTIONS.has(action) || screensForModule(moduleKey).length === 0) return { ok: false, error: "Unknown module or action" };
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "Not found" };
  if (!outranks(session.level, role.approvalLevel)) return { ok: false, error: OUTRANKED };
  const perms = parsePerms(role.permissions);
  // migrate away any legacy module-level key so screen keys are the single source of truth
  delete perms[moduleKey];
  for (const s of screensForModule(moduleKey)) applyToggle(perms, s.key, action, enabled);
  await db.role.update({ where: { id: roleId }, data: { permissions: JSON.stringify(perms) } });
  await audit({ action: "Updated", entity: "Role", entityId: roleId, summary: `Changed ${role.name} access: all ${moduleKey} screens · ${action} = ${enabled}` });
  revalidatePath("/settings/roles");
  return { ok: true };
}

export async function deleteRole(roleId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "Not found" };
  if (!outranks(session.level, role.approvalLevel)) return { ok: false, error: OUTRANKED };
  const inUse = await db.companyMembership.count({ where: { roleId } });
  if (inUse > 0) return { ok: false, error: `Assigned to ${inUse} user(s)` };
  await db.role.delete({ where: { id: roleId } });
  await audit({ action: "Deleted", entity: "Role", summary: `Deleted role ${role.name}` });
  revalidatePath("/settings/roles");
  return { ok: true };
}
