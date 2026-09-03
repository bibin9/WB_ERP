"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function changePassword(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const session = await getSession();
  if (!session) return "You are not signed in.";

  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  const confirm = String(formData.get("confirm") || "");

  if (!current || !next) return "Please fill in all fields.";
  if (next.length < 6) return "New password must be at least 6 characters.";
  if (next === current) return "New password must be different from the current one.";
  if (next !== confirm) return "New passwords do not match.";

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) return "No password is set on this account.";

  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) return "Your current password is incorrect.";

  const passwordHash = await bcrypt.hash(next, 10);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, mustReset: false, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });
  await audit({ action: "Updated", entity: "User", entityId: user.id, summary: "Changed own password" });
  redirect("/account?changed=1");
}
