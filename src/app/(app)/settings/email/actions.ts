"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { seal } from "@/lib/secrets";
import { sendTest } from "@/lib/mailer";
import { checkSettings, SECURITY_MODES } from "@/lib/mailsettings";

/**
 * Mail server settings.
 *
 * The password is write-only. A blank one on the form means "leave what is
 * there" rather than "clear it", because the form cannot show the existing
 * password and a blank box would otherwise wipe it every time somebody changed
 * the port. Clearing is a separate, deliberate act.
 */

export type Result = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;

async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  return session.companies.some((c) => c.id === companyId) ? session : null;
}

export async function saveMailSettings(formData: FormData): Promise<Result> {
  if (!(await allow("settings.email", "edit"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const existing = await db.emailSettings.findUnique({ where: { companyId } });

  const password = String(formData.get("password") ?? "");
  const clearPassword = str(formData, "clearPassword") === "on";
  const username = orNull(formData, "username");

  const security = SECURITY_MODES.includes(str(formData, "security") as never)
    ? str(formData, "security")
    : "STARTTLS";

  const draft = {
    host: str(formData, "host", 200),
    port: Number(formData.get("port")) || 0,
    security,
    username,
    fromName: orNull(formData, "fromName", 120),
    fromEmail: str(formData, "fromEmail"),
    replyTo: orNull(formData, "replyTo"),
    isActive: str(formData, "isActive") !== "off",
  };

  // Whether a password will exist AFTER this save, which is what the rules
  // need to know — not whether one was typed into this particular form.
  const hasPassword = clearPassword ? false : password ? true : !!existing?.password;

  const fit = checkSettings({ ...draft, hasPassword });
  if (!fit.ok) return fit;

  const data = {
    ...draft,
    ...(clearPassword ? { password: null } : password ? { password: seal(password) } : {}),
    updatedBy: session.user.name,
    // Any change to how it connects makes the last test result meaningless.
    ...(existing &&
    (existing.host !== draft.host ||
      existing.port !== draft.port ||
      existing.security !== draft.security ||
      existing.username !== draft.username ||
      password ||
      clearPassword)
      ? { lastTestedAt: null, lastTestOk: null, lastTestError: null }
      : {}),
  };

  if (existing) {
    await db.emailSettings.update({ where: { companyId }, data });
  } else {
    await db.emailSettings.create({ data: { companyId, ...data } });
  }

  await audit({
    action: existing ? "Updated" : "Created",
    entity: "EmailSettings",
    entityId: companyId,
    // Deliberately says nothing about the password beyond whether one is set.
    summary:
      `Mail server set to ${draft.host}:${draft.port} (${security}), sending as ${draft.fromEmail}` +
      (clearPassword ? ", password cleared" : password ? ", password changed" : ""),
  });

  revalidatePath("/settings/email");
  return { ok: true };
}

export async function testMailSettings(formData: FormData): Promise<Result> {
  if (!(await allow("settings.email", "edit"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true } });

  const res = await sendTest({
    companyId,
    to: str(formData, "to"),
    by: session.user.name,
    companyName: company?.name,
  });

  await audit({
    action: "Updated",
    entity: "EmailSettings",
    entityId: companyId,
    summary: res.ok ? `Test email sent to ${str(formData, "to")}` : `Test email failed: ${res.error}`,
  });

  revalidatePath("/settings/email");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
