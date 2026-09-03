"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { activeTenant } from "@/config/tenant";
import { signSession } from "@/lib/session-token";
import { setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { notify } from "@/lib/notify";

const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 15;

/** Notify all admin-level users when an account auto-locks (security event). */
async function notifyAdminsOfLock(tenantId: string, lockedName: string, lockedEmail: string) {
  const admins = await db.companyMembership.findMany({
    where: { company: { tenantId }, role: { approvalLevel: { gte: 80 } } },
    select: { userId: true },
  });
  await notify(tenantId, admins.map((a) => a.userId), {
    type: "info",
    title: `Security alert: ${lockedName} locked out`,
    body: `${lockedEmail} was locked after ${MAX_ATTEMPTS} failed sign-in attempts.`,
    link: "/users",
  });
}

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email || !password) return "Please enter your email and password.";

  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  if (!tenant) return "Tenant not configured.";

  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (!user || !user.passwordHash) return "Invalid email or password.";
  if (!user.isActive) return "This account is deactivated. Please contact your administrator.";

  // Locked?
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    const soon = mins > 60 * 24 ? "" : ` Try again in ${mins} minute${mins === 1 ? "" : "s"}, or`;
    return `Your account is locked.${soon} contact your administrator to unlock it.`;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil } });
      await notifyAdminsOfLock(tenant.id, user.name, user.email);
      return `Too many failed attempts — your account is locked for ${LOCK_MINUTES} minutes.`;
    }
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: attempts } });
    const left = MAX_ATTEMPTS - attempts;
    return `Invalid email or password. ${left} attempt${left === 1 ? "" : "s"} left before your account locks.`;
  }

  // Success — clear counters
  if (user.failedAttempts !== 0 || user.lockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  const token = await signSession({ uid: user.id, tid: tenant.id, name: user.name, email: user.email });
  await setSessionCookie(token);
  if (user.mustReset) redirect("/account?forceChange=1");
  redirect("/dashboard");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
