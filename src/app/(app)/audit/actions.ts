"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { archiveTenant } from "@/lib/auditarchive";
import { validateRetentionDays, retentionLabel } from "@/lib/auditmeta";

/**
 * How long entries stay on the live trail.
 *
 * Behind both the audit permission and an administrator check: shortening the
 * window is how somebody would try to push their own activity out of the
 * default view, so the change itself is written to the trail it governs.
 */
export async function setAuditRetention(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  if (!(await allow("audit.log", "edit"))) return "You do not have permission to change this.";
  const session = await getSession();
  if (!session || !(await canAdminister())) return "Only an administrator can change the retention period.";

  const checked = validateRetentionDays(formData.get("days"));
  if (!checked.ok) return checked.error;

  const before = await db.tenant.findUnique({
    where: { id: session.tenant.id },
    select: { auditRetentionDays: true },
  });
  if (before?.auditRetentionDays === checked.days) return undefined;

  await db.tenant.update({
    where: { id: session.tenant.id },
    data: { auditRetentionDays: checked.days },
  });
  await audit({
    action: "Updated",
    entity: "Audit retention",
    entityId: session.tenant.id,
    summary: `Retention changed from ${retentionLabel(before?.auditRetentionDays ?? 0)} to ${retentionLabel(checked.days)}.`,
  });

  revalidatePath("/audit");
  return undefined;
}

/**
 * Move everything past the window now, rather than waiting for the next deploy.
 *
 * The result is itself audited, so the trail can account for its own gaps: an
 * entry that is not on this screen is on the archive tab, and this says when it
 * went and how many went with it.
 */
export async function runAuditArchive(): Promise<string | undefined> {
  if (!(await allow("audit.log", "edit"))) return "You do not have permission to do this.";
  const session = await getSession();
  if (!session || !(await canAdminister())) return "Only an administrator can archive entries.";

  const result = await archiveTenant(session.tenant.id);
  if (result.moved > 0) {
    await audit({
      action: "Archived",
      entity: "Audit trail",
      entityId: session.tenant.id,
      summary:
        `Moved ${result.moved.toLocaleString()} entries dated before ` +
        `${result.cutoff.toISOString().slice(0, 10)} to the archive` +
        (result.more ? " — more remain and will move on the next run." : "."),
    });
  }

  revalidatePath("/audit");
  return result.moved === 0
    ? "Nothing is past its retention window yet."
    : `Moved ${result.moved.toLocaleString()} entr${result.moved === 1 ? "y" : "ies"} to the archive.`;
}
