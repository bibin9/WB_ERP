"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { activeTenant } from "@/config/tenant";
import { signSession } from "@/lib/session-token";
import { setSessionCookie, clearSessionCookie, getSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { auditAuth } from "@/lib/audit";
import { AUTH_ACTIONS, clientIp, typedEmailLabel } from "@/lib/auditmeta";
import { keysFor, reserveAttempt, releaseAttempt, sweep, LIMITS, LOCK_MS, WRONG, PAUSED } from "@/lib/signin-throttle";

/**
 * Compared against when there is no such account, so a made-up address takes
 * as long to refuse as a real one with the wrong password.
 */
const NOBODY = bcrypt.hashSync("no account has this password", 10);

/** Notify all admin-level users when an account is paused for everybody (security event). */
async function notifyAdminsOfLock(tenantId: string, lockedName: string, lockedEmail: string) {
  const admins = await db.companyMembership.findMany({
    where: { company: { tenantId }, role: { approvalLevel: { gte: 80 } } },
    select: { userId: true },
  });
  await notify(tenantId, [...new Set(admins.map((a) => a.userId))], {
    type: "info",
    title: `Security alert: sign-in paused for ${lockedName}`,
    body: `${lockedEmail} had ${LIMITS.account} wrong passwords from different places within 15 minutes, so sign-in to it is paused for ${LOCK_MS / 60000} minutes. If that was not them, someone is guessing.`,
    link: "/users",
  });
}

async function callerAddress(): Promise<string | null> {
  try {
    return clientIp(await headers());
  } catch {
    return null;
  }
}

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") || "").slice(0, 200);
  if (!email || !password) return "Please enter your email and password.";

  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  if (!tenant) return "Tenant not configured.";

  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });

  // Counted before the password is looked at — see lib/signin-throttle.ts.
  const keys = keysFor(user?.id ?? `email:${email}`, await callerAddress());
  if (Math.random() < 0.02) await sweep().catch(() => undefined);
  const turn = await reserveAttempt(keys);
  if (!turn.allowed) {
    await auditAuth({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      userName: user?.name ?? typedEmailLabel(email),
      action: turn.accountLocked ? AUTH_ACTIONS.lockedOut : AUTH_ACTIONS.failed,
      summary: turn.accountLocked
        ? `Sign-in paused for everybody for ${LOCK_MS / 60000} minutes after ${LIMITS.account} wrong passwords from different places.`
        : "Sign-in refused without checking the password: too many recent wrong tries.",
    });
    if (turn.accountLocked && user) {
      // Shown on the Users screen, where an administrator can lift it early.
      await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
      await notifyAdminsOfLock(tenant.id, user.name, user.email);
    }
    return PAUSED;
  }

  const ok = await bcrypt.compare(password, user?.passwordHash || NOBODY);
  if (!user || !user.passwordHash || !ok) {
    await auditAuth({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      userName: user?.name ?? typedEmailLabel(email),
      action: AUTH_ACTIONS.failed,
      summary: !user
        ? "Sign-in attempt with an email address that matches no account."
        : !user.passwordHash
          ? "Sign-in attempt on an account that has no password set."
          : "Wrong password.",
    });
    return WRONG;
  }

  // The password is right, so this was not a guess: hand the attempt back.
  await releaseAttempt(keys);

  if (!user.isActive) {
    await auditAuth({
      tenantId: tenant.id, userId: user.id, userName: user.name,
      action: AUTH_ACTIONS.failed,
      summary: "Correct password on a deactivated account.",
    });
    return "This account is deactivated. Please contact your administrator.";
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await auditAuth({
      tenantId: tenant.id, userId: user.id, userName: user.name,
      action: AUTH_ACTIONS.failed,
      summary: "Correct password on a locked account.",
    });
    return "Your account is locked. Contact your administrator to unlock it.";
  }

  if (user.failedAttempts !== 0 || user.lockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  const token = await signSession({ uid: user.id, tid: tenant.id, name: user.name, email: user.email });
  await setSessionCookie(token);
  await auditAuth({
    tenantId: tenant.id, userId: user.id, userName: user.name,
    action: AUTH_ACTIONS.signedIn,
    summary: "Signed in successfully.",
  });
  if (user.mustReset) redirect("/account?forceChange=1");
  redirect("/dashboard");
}

export async function logout() {
  const s = await getSession();
  if (s) {
    // Ends this session everywhere it might have been copied to: a token is
    // valid on its own for up to twelve hours, so clearing the cookie on this
    // browser was not enough to stop a stolen copy (lib/auth.ts).
    await db.user.update({ where: { id: s.user.id }, data: { sessionsEndedAt: new Date() } });
    await auditAuth({
      tenantId: s.tenant.id, userId: s.user.id, userName: s.user.name,
      action: AUTH_ACTIONS.signedOut,
      summary: "Signed out — every session issued before now has ended.",
    });
  }
  await clearSessionCookie();
  redirect("/login");
}
