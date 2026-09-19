"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { cookies, headers } from "next/headers";
import { getSession, signSession, SESSION_COOKIE } from "@/lib/auth";
import { SESSION_SECONDS } from "@/lib/session-token";
import { passwordProblem } from "@/lib/password-policy";
import { keysFor, reserveAttempt, releaseAttempt, PAUSED } from "@/lib/signin-throttle";
import { clientIp } from "@/lib/auditmeta";
import { audit } from "@/lib/audit";

export async function changePassword(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const session = await getSession();
  if (!session) return "You are not signed in.";

  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  const confirm = String(formData.get("confirm") || "");

  if (!current || !next) return "Please fill in all fields.";
  if (next === current) return "New password must be different from the current one.";
  if (next !== confirm) return "New passwords do not match.";
  const weak = passwordProblem(next, { email: session.user.email, name: session.user.name });
  if (weak) return weak;

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) return "No password is set on this account.";

  // The current password is checked under the same limits as signing in, so
  // somebody holding an unlocked screen cannot use this form to guess it.
  const keys = keysFor(user.id, clientIp(await headers()));
  const turn = await reserveAttempt(keys);
  if (!turn.allowed) return PAUSED;
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) return "Your current password is incorrect.";
  await releaseAttempt(keys);

  const passwordHash = await bcrypt.hash(next, 10);
  const changedAt = new Date();
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, mustReset: false, passwordChangedAt: changedAt, failedAttempts: 0, lockedUntil: null },
  });

  // Every session issued before this moment is now dead — that is the point of
  // changing a password, and until now it did not happen. This device keeps
  // working because it is handed a token issued after the change; a session
  // somebody else is holding is not.
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession({
    uid: user.id, tid: user.tenantId, name: user.name, email: user.email,
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });

  await audit({
    action: "Updated",
    entity: "User",
    entityId: user.id,
    summary: "Changed own password — other sessions signed out",
  });
  redirect("/account?changed=1");
}
