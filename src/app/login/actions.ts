"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { activeTenant } from "@/config/tenant";
import { signSession } from "@/lib/session-token";
import { setSessionCookie, clearSessionCookie, getSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { auditAuth } from "@/lib/audit";
import { AUTH_ACTIONS, typedEmailLabel } from "@/lib/auditmeta";

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
  // Every branch below records what actually happened while telling the visitor
  // the same thing. Whether an email belongs to a real account is not something
  // a login page should confirm; it is exactly what an administrator reading the
  // audit log needs to know.
  if (!user || !user.passwordHash) {
    await auditAuth({
      tenantId: tenant.id,
      userName: typedEmailLabel(email),
      action: AUTH_ACTIONS.failed,
      summary: user
        ? "Sign-in attempt on an account that has no password set."
        : "Sign-in attempt with an email address that matches no account.",
    });
    return "Invalid email or password.";
  }
  if (!user.isActive) {
    await auditAuth({
      tenantId: tenant.id, userId: user.id, userName: user.name,
      action: AUTH_ACTIONS.failed,
      summary: "Sign-in attempt on a deactivated account.",
    });
    return "This account is deactivated. Please contact your administrator.";
  }

  // Locked?
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    const soon = mins > 60 * 24 ? "" : ` Try again in ${mins} minute${mins === 1 ? "" : "s"}, or`;
    await auditAuth({
      tenantId: tenant.id, userId: user.id, userName: user.name,
      action: AUTH_ACTIONS.failed,
      summary: `Sign-in attempt while the account was locked — ${mins} minute${mins === 1 ? "" : "s"} still to run.`,
    });
    return `Your account is locked.${soon} contact your administrator to unlock it.`;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil } });
      // Two entries, not one: the wrong password and the lock it caused are
      // separate facts, and counting attempts in the log should not require
      // knowing that the third one is recorded differently from the first two.
      await auditAuth({
        tenantId: tenant.id, userId: user.id, userName: user.name,
        action: AUTH_ACTIONS.failed,
        summary: `Wrong password (attempt ${attempts} of ${MAX_ATTEMPTS}).`,
      });
      await auditAuth({
        tenantId: tenant.id, userId: user.id, userName: user.name,
        action: AUTH_ACTIONS.lockedOut,
        summary: `Account locked for ${LOCK_MINUTES} minutes after ${MAX_ATTEMPTS} failed attempts.`,
      });
      await notifyAdminsOfLock(tenant.id, user.name, user.email);
      return `Too many failed attempts — your account is locked for ${LOCK_MINUTES} minutes.`;
    }
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: attempts } });
    await auditAuth({
      tenantId: tenant.id, userId: user.id, userName: user.name,
      action: AUTH_ACTIONS.failed,
      summary: `Wrong password (attempt ${attempts} of ${MAX_ATTEMPTS}).`,
    });
    const left = MAX_ATTEMPTS - attempts;
    return `Invalid email or password. ${left} attempt${left === 1 ? "" : "s"} left before your account locks.`;
  }

  // Success — clear counters
  const failedBefore = user.failedAttempts;
  if (user.failedAttempts !== 0 || user.lockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  const token = await signSession({ uid: user.id, tid: tenant.id, name: user.name, email: user.email });
  await setSessionCookie(token);
  // Written before the redirect, because redirect() in Next throws to unwind the
  // request and anything after it never runs.
  await auditAuth({
    tenantId: tenant.id, userId: user.id, userName: user.name,
    action: AUTH_ACTIONS.signedIn,
    summary: failedBefore > 0
      ? `Signed in successfully after ${failedBefore} failed attempt${failedBefore === 1 ? "" : "s"}.`
      : "Signed in successfully.",
  });
  if (user.mustReset) redirect("/account?forceChange=1");
  redirect("/dashboard");
}

export async function logout() {
  // Read the session before the cookie goes, or there is nobody to attribute
  // the sign-out to.
  const s = await getSession();
  if (s) {
    await auditAuth({
      tenantId: s.tenant.id, userId: s.user.id, userName: s.user.name,
      action: AUTH_ACTIONS.signedOut,
      summary: "Signed out.",
    });
  }
  await clearSessionCookie();
  redirect("/login");
}
