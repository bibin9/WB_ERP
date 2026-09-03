import "server-only";
import { db } from "./db";
import { getSession } from "./auth";

type AuditInput = {
  action: string; // Created | Updated | Approved | Rejected | Deleted | Posted
  entity: string; // Company | User | JournalEntry | ApprovalRequest | Employee | ...
  entityId?: string | null;
  summary: string;
};

/** Write an audit-trail entry for the current user. Immutable record. */
export async function audit(input: AuditInput) {
  const s = await getSession();
  if (!s) return;
  await db.auditLog.create({
    data: {
      tenantId: s.tenant.id,
      userId: s.user.id,
      userName: s.user.name,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      summary: input.summary,
    },
  });
}
