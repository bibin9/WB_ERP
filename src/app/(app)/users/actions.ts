"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { levelOf, outranks, OUTRANKED } from "@/lib/rank";
import { passwordProblem, temporaryPassword } from "@/lib/password-policy";
import { clearAccount } from "@/lib/signin-throttle";

type Result = { ok: boolean; error?: string };

/**
 * The acting administrator, and their level.
 *
 * Every action here used to stop at "is an administrator". Now each one also
 * asks whether the administrator outranks the person or role being changed —
 * see lib/rank.ts for why, and what that closed.
 */
async function admin() {
  const session = await getSession();
  if (!session || !(await canAdminister())) return null;
  return { session, level: levelOf(session.companies.map((c) => c.approvalLevel)) };
}

/** A user in this tenant, with the level of the most senior role they hold. */
async function target(id: string, tenantId: string) {
  const user = await db.user.findFirst({
    where: { id, tenantId },
    include: { memberships: { include: { role: { select: { approvalLevel: true } } } } },
  });
  if (!user) return null;
  return { user, level: levelOf(user.memberships.map((m) => m.role.approvalLevel)) };
}

export async function createUser(formData: FormData): Promise<Result> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  const { session, level } = a;

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const roleId = String(formData.get("roleId") || "");
  const companyIds = [...new Set(formData.getAll("companyIds").map(String).filter(Boolean))];
  if (!name || !email || !password || !roleId || companyIds.length === 0) {
    return { ok: false, error: "Fill in the name, email, password, role and at least one company." };
  }
  const weak = passwordProblem(password, { email, name });
  if (weak) return { ok: false, error: weak };

  const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
  if (!role) return { ok: false, error: "That role no longer exists." };
  if (!outranks(level, role.approvalLevel)) return { ok: false, error: OUTRANKED };
  // The companies came from the form, so they are checked: only this group's.
  const companies = await db.company.count({ where: { id: { in: companyIds }, tenantId: session.tenant.id } });
  if (companies !== companyIds.length) return { ok: false, error: "One of those companies is not in this group." };

  const exists = await db.user.findUnique({ where: { tenantId_email: { tenantId: session.tenant.id, email } } });
  if (exists) return { ok: false, error: "Someone already uses that email address." };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    // The administrator chose this password, so it is only good for the first
    // sign-in: the person is made to pick their own, which nobody else knows.
    data: { tenantId: session.tenant.id, name, email, passwordHash, mustReset: true },
  });
  await db.companyMembership.createMany({
    data: companyIds.map((companyId) => ({ userId: user.id, companyId, roleId })),
  });
  await audit({ action: "Created", entity: "User", entityId: user.id, summary: `Added user ${name} (${email}) as ${role.name}` });
  revalidatePath("/users");
  return { ok: true };
}

export async function setUserActive(id: string, next: boolean): Promise<Result> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  if (id === a.session.user.id) return { ok: false, error: "You cannot deactivate your own account." };
  const t = await target(id, a.session.tenant.id);
  if (!t) return { ok: false, error: "Not found" };
  if (!outranks(a.level, t.level)) return { ok: false, error: OUTRANKED };
  await db.user.update({ where: { id }, data: { isActive: next } });
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `${next ? "Activated" : "Deactivated"} user ${t.user.name}` });
  revalidatePath("/users");
  return { ok: true };
}

export async function updateUser(formData: FormData): Promise<Result> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  const { session, level } = a;
  const id = String(formData.get("id") || "");
  const t = await target(id, session.tenant.id);
  if (!t) return { ok: false, error: "Not found" };
  const name = String(formData.get("name") || "").trim();
  const roleId = String(formData.get("roleId") || "");
  if (!name) return { ok: false, error: "Enter a name." };

  const self = id === session.user.id;
  // Correcting your own name is fine; anything about anyone else needs rank.
  if (!self && !outranks(level, t.level)) return { ok: false, error: OUTRANKED };

  let roleName: string | null = null;
  if (roleId) {
    // Nobody changes their own role — that is how a Director became Group Admin.
    if (self) return { ok: false, error: "You cannot change your own role. Ask someone more senior." };
    const role = await db.role.findFirst({ where: { id: roleId, tenantId: session.tenant.id } });
    if (!role) return { ok: false, error: "That role no longer exists." };
    if (!outranks(level, role.approvalLevel)) return { ok: false, error: OUTRANKED };
    roleName = role.name;
  }

  // Company access. Sent by the edit form since it gained the company boxes;
  // a caller that sends none leaves the companies as they are.
  const companyIds = [...new Set(formData.getAll("companyIds").map(String).filter(Boolean))];
  const sentCompanies = formData.has("companyIds") || formData.get("companiesShown") === "1";
  const current = t.user.memberships.map((m) => m.companyId);
  const adding = sentCompanies ? companyIds.filter((c) => !current.includes(c)) : [];
  const removing = sentCompanies ? current.filter((c) => !companyIds.includes(c)) : [];
  if (adding.length || removing.length) {
    // Nobody widens their own reach, for the same reason nobody sets their own role.
    if (self) return { ok: false, error: "You cannot change your own companies. Ask someone more senior." };
    if (companyIds.length === 0) return { ok: false, error: "Leave at least one company ticked. To stop someone signing in, deactivate them instead." };
    const inGroup = await db.company.count({ where: { id: { in: adding }, tenantId: session.tenant.id } });
    if (inGroup !== adding.length) return { ok: false, error: "One of those companies is not in this group." };
  }
  // A company being added takes the role chosen, or the role they hold now.
  const newRoleId = roleId || t.user.memberships[0]?.roleId;
  if (adding.length && !newRoleId) return { ok: false, error: "Choose a role for the companies being added." };

  await db.$transaction([
    db.user.update({ where: { id }, data: { name } }),
    ...(roleId ? [db.companyMembership.updateMany({ where: { userId: id }, data: { roleId } })] : []),
    ...(removing.length ? [db.companyMembership.deleteMany({ where: { userId: id, companyId: { in: removing } } })] : []),
    ...(adding.length ? [db.companyMembership.createMany({ data: adding.map((companyId) => ({ userId: id, companyId, roleId: newRoleId! })) })] : []),
  ]);
  const codes = async (ids: string[]) => (await db.company.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((c) => c.code).join(", ");
  const changes = [
    roleName ? `role set to ${roleName}` : "",
    adding.length ? `added to ${await codes(adding)}` : "",
    removing.length ? `removed from ${await codes(removing)}` : "",
  ].filter(Boolean);
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `Updated user ${name}${changes.length ? ` — ${changes.join("; ")}` : ""}` });
  revalidatePath("/users");
  return { ok: true };
}

/** Admin: generate a temporary password, force the user to change it on next sign-in. Returns the temp password to hand over. */
export async function resetUserPassword(id: string): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  if (id === a.session.user.id) return { ok: false, error: "Change your own password from My Account." };
  const t = await target(id, a.session.tenant.id);
  if (!t) return { ok: false, error: "Not found" };
  // The administrator is shown the new password, so this is the one action
  // where rank matters most: it is a sign-in as that person.
  if (!outranks(a.level, t.level)) return { ok: false, error: OUTRANKED };

  const tempPassword = temporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await db.user.update({
    where: { id },
    data: {
      passwordHash,
      mustReset: true,
      // The reason an administrator resets a password is usually that somebody
      // else has it. Stamping the change is what actually signs that person
      // out — without it the new password locks the door while the old session
      // is still inside.
      passwordChangedAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await audit({
    action: "Updated",
    entity: "User",
    entityId: id,
    summary: `Reset password for ${t.user.name} (temporary, must change on next sign-in; existing sessions signed out)`,
  });
  revalidatePath("/users");
  return { ok: true, tempPassword };
}

/** Admin: lock or unlock a user account. Locking blocks sign-in until unlocked. */
export async function setUserLock(id: string, locked: boolean): Promise<Result> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  if (id === a.session.user.id) return { ok: false, error: "You cannot lock your own account" };
  const t = await target(id, a.session.tenant.id);
  if (!t) return { ok: false, error: "Not found" };
  if (!outranks(a.level, t.level)) return { ok: false, error: OUTRANKED };
  await db.user.update({
    where: { id },
    // Indefinite lock until an admin unlocks; unlock also clears the failed-attempt counter.
    data: locked ? { lockedUntil: new Date("2999-01-01") } : { lockedUntil: null, failedAttempts: 0 },
  });
  // Unlocking also lifts any sign-in pause on the account (lib/signin-throttle.ts).
  if (!locked) await clearAccount(id);
  await audit({ action: "Updated", entity: "User", entityId: id, summary: `${locked ? "Locked" : "Unlocked"} account for ${t.user.name}` });
  revalidatePath("/users");
  return { ok: true };
}

export async function deleteUser(id: string): Promise<Result> {
  const a = await admin();
  if (!a) return { ok: false, error: "Not authorised" };
  if (id === a.session.user.id) return { ok: false, error: "You cannot delete yourself" };
  const t = await target(id, a.session.tenant.id);
  if (!t) return { ok: false, error: "Not found" };
  if (!outranks(a.level, t.level)) return { ok: false, error: OUTRANKED };
  await db.user.delete({ where: { id } });
  await audit({ action: "Deleted", entity: "User", entityId: id, summary: `Deleted user ${t.user.name} (${t.user.email})` });
  revalidatePath("/users");
  return { ok: true };
}
