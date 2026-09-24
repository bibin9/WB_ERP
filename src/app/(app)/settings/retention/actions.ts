"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { archiveTenant } from "@/lib/auditarchive";
import { archiveEmailLogs, pruneNotifications, policyOf, validateDays, retentionLabel } from "@/lib/data-retention";

/**
 * Changing a retention window, and running the move now.
 *
 * Administrator only, on top of the screen's own permission: shortening a
 * window is how somebody would push their own activity off the default view,
 * so every change here is written to the audit trail it governs.
 */
export async function setRetention(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  if (!(await allow("settings.retention", "edit"))) return "You do not have permission to change this.";
  const session = await getSession();
  if (!session || !(await canAdminister())) return "Only an administrator can change a retention period.";

  const policy = policyOf(String(formData.get("key") || ""));
  if (!policy) return "That setting no longer exists.";

  const checked = validateDays(policy, formData.get("days"));
  if (!checked.ok) return checked.error;

  const before = await db.tenant.findUnique({ where: { id: session.tenant.id }, select: { [policy.field]: true } as never });
  const was = (before as Record<string, number> | null)?.[policy.field] ?? policy.defaultDays;
  if (was === checked.days) return undefined;

  await db.tenant.update({ where: { id: session.tenant.id }, data: { [policy.field]: checked.days } });
  await audit({
    action: "Updated",
    entity: "Data retention",
    entityId: session.tenant.id,
    summary: `${policy.label}: kept for ${retentionLabel(was)} before, ${retentionLabel(checked.days)} now.`,
  });

  revalidatePath("/settings/retention");
  return undefined;
}

/** Move everything past its window now, rather than waiting for the next deploy. */
export async function runRetention(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  if (!(await allow("settings.retention", "edit"))) return "You do not have permission to do this.";
  const session = await getSession();
  if (!session || !(await canAdminister())) return "Only an administrator can run this.";

  const policy = policyOf(String(formData.get("key") || ""));
  if (!policy) return "That setting no longer exists.";

  const result =
    policy.key === "audit"
      ? await archiveTenant(session.tenant.id)
      : policy.key === "email"
        ? await archiveEmailLogs(session.tenant.id)
        : await pruneNotifications(session.tenant.id);

  const moved = "moved" in result ? result.moved : 0;
  if (moved > 0) {
    await audit({
      action: "Updated",
      entity: "Data retention",
      entityId: session.tenant.id,
      summary:
        `${policy.label}: ${moved.toLocaleString()} record(s) ` +
        `${policy.destination === "Archive" ? "moved to the archive" : "removed"}, ` +
        `older than ${result.cutoff.toISOString().slice(0, 10)}.`,
    });
  }

  revalidatePath("/settings/retention");
  return undefined;
}
