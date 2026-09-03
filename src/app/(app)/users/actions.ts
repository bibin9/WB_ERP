"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function createUser(formData: FormData) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const roleId = String(formData.get("roleId") || "");
  const companyIds = formData.getAll("companyIds").map(String).filter(Boolean);
  if (!name || !email || !password || !roleId || companyIds.length === 0) return;

  const exists = await db.user.findUnique({
    where: { tenantId_email: { tenantId: session.tenant.id, email } },
  });
  if (exists) return;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: { tenantId: session.tenant.id, name, email, passwordHash },
  });
  await db.companyMembership.createMany({
    data: companyIds.map((companyId) => ({ userId: user.id, companyId, roleId })),
  });
  await audit({ action: "Created", entity: "User", entityId: user.id, summary: `Added user ${name} (${email})` });
  revalidatePath("/users");
}

export async function setUserActive(id: string, next: boolean) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const user = await db.user.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!user) return;
  await db.user.update({ where: { id }, data: { isActive: next } });
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `${next ? "Activated" : "Deactivated"} user ${user.name}` });
  revalidatePath("/users");
}

export async function updateUser(formData: FormData) {
  const session = await getSession();
  if (!session || !(await canAdminister())) return;
  const id = String(formData.get("id") || "");
  const user = await db.user.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!user) return;
  const name = String(formData.get("name") || "").trim();
  const roleId = String(formData.get("roleId") || "");
  if (!name) return;

  await db.user.update({ where: { id }, data: { name } });
  if (roleId) {
    const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
    if (role) await db.companyMembership.updateMany({ where: { userId: id }, data: { roleId } });
  }
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `Updated user ${name}` });
  revalidatePath("/users");
}

/** Admin: generate a temporary password, force the user to change it on next sign-in. Returns the temp password to hand over. */
export async function resetUserPassword(id: string): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const session = await getSession();
  if (!session || !(await canAdminister())) return { ok: false, error: "Not authorised" };
  const user = await db.user.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!user) return { ok: false, error: "Not found" };

  // Readable, reasonably strong temporary password
  const rand = Math.random().toString(36).slice(2, 8);
  const tempPassword = `Wb-${rand}${Math.floor(10 + Math.random() * 89)}`;
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await db.user.update({
    where: { id },
    data: { passwordHash, mustReset: true, failedAttempts: 0, lockedUntil: null },
  });
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `Reset password for ${user.name} (temporary, must change on next sign-in)` });
  revalidatePath("/users");
  return { ok: true, tempPassword };
}

/** Admin: lock or unlock a user account. Locking blocks sign-in until unlocked. */
export async function setUserLock(id: string, locked: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !(await canAdminister())) return { ok: false, error: "Not authorised" };
  if (id === session.user.id) return { ok: false, error: "You cannot lock your own account" };
  const user = await db.user.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!user) return { ok: false, error: "Not found" };
  await db.user.update({
    where: { id },
    // Indefinite lock until an admin unlocks; unlock also clears the failed-attempt counter.
    data: locked ? { lockedUntil: new Date("2999-01-01") } : { lockedUntil: null, failedAttempts: 0 },
  });
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `${locked ? "Locked" : "Unlocked"} account for ${user.name}` });
  revalidatePath("/users");
  return { ok: true };
}

export async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !(await canAdminister())) return { ok: false, error: "Not authorised" };
  if (id === session.user.id) return { ok: false, error: "You cannot delete yourself" };
  const user = await db.user.findFirst({ where: { id, tenantId: session.tenant.id } });
  if (!user) return { ok: false, error: "Not found" };
  await db.user.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "User", entityId: id, summary: `Deleted user ${user.name} (${user.email})` });
  revalidatePath("/users");
  return { ok: true };
}
