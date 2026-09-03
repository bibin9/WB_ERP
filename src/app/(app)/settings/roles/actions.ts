"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { parsePerms, screensForModule } from "@/lib/rbac";
import { audit } from "@/lib/audit";

async function guard() {
  const session = await getSession();
  if (!session || !(await canAdminister())) return null;
  return session;
}

export async function createRole(formData: FormData) {
  const session = await guard();
  if (!session) return;
  const name = String(formData.get("name") || "").trim();
  const approvalLevel = Number(formData.get("approvalLevel")) || 0;
  if (!name) return;
  const exists = await db.role.findUnique({ where: { tenantId_name: { tenantId: session.tenant.id, name } } });
  if (exists) return;
  await db.role.create({ data: { tenantId: session.tenant.id, name, approvalLevel, permissions: "{}" } });
  await audit({ action: "Created", entity: "Role", summary: `Created role ${name} (L${approvalLevel})` });
  revalidatePath("/settings/roles");
}

export async function updateRoleLevel(roleId: string, level: number) {
  const session = await guard();
  if (!session) return;
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return;
  await db.role.update({ where: { id: roleId }, data: { approvalLevel: level } });
  revalidatePath("/settings/roles");
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
export async function setRolePermission(roleId: string, screenKey: string, action: string, enabled: boolean) {
  const session = await guard();
  if (!session) return;
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return;
  const perms = parsePerms(role.permissions);
  applyToggle(perms, screenKey, action, enabled);
  await db.role.update({ where: { id: roleId }, data: { permissions: JSON.stringify(perms) } });
  await audit({ action: "Updated", entity: "Role", entityId: roleId, summary: `Changed ${role.name} access: ${screenKey}.${action} = ${enabled}` });
  revalidatePath("/settings/roles");
}

/** Toggle an action across every screen in a module at once (the module header "All" control). */
export async function setModulePermission(roleId: string, moduleKey: string, action: string, enabled: boolean) {
  const session = await guard();
  if (!session) return;
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return;
  const perms = parsePerms(role.permissions);
  // migrate away any legacy module-level key so screen keys are the single source of truth
  delete perms[moduleKey];
  for (const s of screensForModule(moduleKey)) applyToggle(perms, s.key, action, enabled);
  await db.role.update({ where: { id: roleId }, data: { permissions: JSON.stringify(perms) } });
  await audit({ action: "Updated", entity: "Role", entityId: roleId, summary: `Changed ${role.name} access: all ${moduleKey} screens · ${action} = ${enabled}` });
  revalidatePath("/settings/roles");
}

export async function deleteRole(roleId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await guard();
  if (!session) return { ok: false, error: "Not authorised" };
  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "Not found" };
  const inUse = await db.companyMembership.count({ where: { roleId } });
  if (inUse > 0) return { ok: false, error: `Assigned to ${inUse} user(s)` };
  await db.role.delete({ where: { id: roleId } });
  await audit({ action: "Deleted", entity: "Role", summary: `Deleted role ${role.name}` });
  revalidatePath("/settings/roles");
  return { ok: true };
}
