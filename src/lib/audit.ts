import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import { getSession } from "./auth";
import { clientIp, clientAgent, SESSION_ENTITY, type AuthAction } from "./auditmeta";

type AuditInput = {
  action: string; // Created | Updated | Approved | Rejected | Deleted | Posted
  entity: string; // Company | User | JournalEntry | ApprovalRequest | Employee | ...
  entityId?: string | null;
  summary: string;
};

/**
 * The address and browser behind the current request.
 *
 * Reading headers costs nothing — they are already in memory for the request —
 * so every entry carries them, not just the authentication ones. It is wrapped
 * because headers() throws outside a request, and a seed script or a background
 * job writing an audit entry should still write it, just without an address.
 */
async function requestOrigin(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return { ipAddress: clientIp(h), userAgent: clientAgent(h) };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/** Write an audit-trail entry for the current user. Immutable record. */
export async function audit(input: AuditInput) {
  const s = await getSession();
  if (!s) return;
  const origin = await requestOrigin();
  await db.auditLog.create({
    data: {
      tenantId: s.tenant.id,
      userId: s.user.id,
      userName: s.user.name,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      summary: input.summary,
      ...origin,
    },
  });
}

type AuthAuditInput = {
  tenantId: string;
  /** Null when the email typed matched no account — there is nobody to point at. */
  userId?: string | null;
  /** The account's name, or the email that was typed if there is no account. */
  userName: string;
  action: AuthAction;
  summary: string;
};

/**
 * Write an authentication entry, without needing a session.
 *
 * audit() above starts by loading the current session and gives up if there
 * isn't one — which is exactly the case that matters most here. A failed sign-in
 * has no session by definition, and those were the entries the ISO 27001 audit
 * found missing: "who read that salary, and from where?" had no answer, and
 * neither did "who has been trying to get in?".
 *
 * The summary written here is deliberately more specific than the message the
 * visitor sees. The screen must not reveal whether an email belongs to a real
 * account; the audit log is behind a permission and exists to tell an
 * administrator precisely that.
 *
 * Failure to write must never block a sign-in, or a full disk becomes an outage
 * and, worse, a locked-out administrator. It is logged and swallowed.
 */
export async function auditAuth(input: AuthAuditInput) {
  try {
    const origin = await requestOrigin();
    await db.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        userName: input.userName,
        action: input.action,
        entity: SESSION_ENTITY,
        entityId: input.userId ?? null,
        summary: input.summary,
        ...origin,
      },
    });
  } catch (err) {
    console.error("[audit] could not record an authentication event", err);
  }
}
