import { db } from "./db";
import { DEFAULT_RETENTION_DAYS, retentionCutoff, retentionLabel } from "./auditmeta";

/**
 * How long each kind of record stays on the live tables, and what happens when
 * it does not.
 *
 * Two rules decide what may appear here at all, and they are worth stating
 * because the obvious next request is "archive the old invoices too":
 *
 *  1. **Nothing a report reads.** A trial balance, job costing, VAT history and
 *     a final settlement all look back over years. Move those rows and the
 *     reports quietly become wrong, which costs far more than a slow page.
 *  2. **Only what grows without being read.** Logs: an entry per action, per
 *     email, per notification. They are the only tables that outgrow the
 *     business data, and nothing reports on them.
 *
 * So this covers the audit trail, sent emails and notifications — and, by
 * design, nothing else. Performance is not the reason: at this size the
 * database is not troubled by history (the indexes do that work). The reasons
 * are keeping a log table from swallowing the disk, and being able to tell an
 * auditor what is kept and for how long.
 *
 * Archived is not deleted. Two of the three move rows to an archive table that
 * is still readable; notifications are removed, because a notification is a
 * copy of something recorded elsewhere — and only once it has been read.
 */

export const ARCHIVE_BATCH = 1000;
export const ARCHIVE_MAX_BATCHES = 500;

export type PolicyKey = "audit" | "email" | "notifications";

export type Policy = {
  key: PolicyKey;
  label: string;
  /** What the records are, for somebody who has never seen the table. */
  what: string;
  /** What happens at the end of the window, in the same plain words. */
  then: string;
  /** The Tenant column holding the window. */
  field: "auditRetentionDays" | "emailLogRetentionDays" | "notificationRetentionDays";
  defaultDays: number;
  minDays: number;
  /** Why it cannot be set shorter than the floor. */
  floorReason: string;
  /** Where the older records go, for the screen. */
  destination: "Archive" | "Removed";
  /** The screen the live records are read on, or null where there is none. */
  href: string | null;
};

export const MAX_DAYS = 3650;

export const POLICIES: Policy[] = [
  {
    key: "audit",
    label: "Audit trail",
    what: "Every change anybody makes: who, what, when, and from where.",
    then: "Moved to the audit archive, readable from the Audit Log screen. Nothing is deleted.",
    field: "auditRetentionDays",
    defaultDays: DEFAULT_RETENTION_DAYS,
    minDays: 30,
    floorReason: "Keep at least 30 days, so this month's own activity is always on the first screen.",
    destination: "Archive",
    href: "/audit",
  },
  {
    key: "email",
    label: "Sent emails",
    what: "One record per email the system sent — the quotation or order, who it went to, and whether it arrived.",
    then: "Moved to the sent-email archive. It stays the evidence that a document was sent, long after the email has gone from anybody's mailbox.",
    field: "emailLogRetentionDays",
    defaultDays: 1095,
    minDays: 365,
    floorReason: "Keep at least a year: a customer disputing that a quotation was ever sent rarely does so within months.",
    destination: "Archive",
    href: null,
  },
  {
    key: "notifications",
    label: "Notifications",
    what: "The alerts in the bell menu — an approval waiting, a task assigned.",
    then: "Removed once read, because each one is a copy of something the system already recorded. Unread notifications are never removed, however old.",
    field: "notificationRetentionDays",
    defaultDays: 180,
    minDays: 30,
    floorReason: "Keep at least 30 days, so somebody back from leave still sees what happened while they were away.",
    destination: "Removed",
    href: "/notifications",
  },
];

export const policyOf = (key: string): Policy | undefined => POLICIES.find((p) => p.key === key);

/** A whole number of days inside this policy's bounds, or a sentence saying why not. */
export function validateDays(policy: Policy, value: unknown): { ok: true; days: number } | { ok: false; error: string } {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null || raw === undefined) return { ok: false, error: "Enter the number of days to keep." };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter the number of days to keep." };
  const days = Math.floor(n);
  if (days < policy.minDays) return { ok: false, error: policy.floorReason };
  if (days > MAX_DAYS) return { ok: false, error: `${MAX_DAYS.toLocaleString()} days (ten years) is the most that can be set.` };
  return { ok: true, days };
}

export { retentionCutoff, retentionLabel };

export type RunResult = {
  key: PolicyKey;
  /** Rows archived or removed. */
  moved: number;
  cutoff: Date;
  days: number;
  /** True when the ceiling was hit and there is more to do on the next run. */
  more: boolean;
};

export type DueRow = {
  policy: Policy;
  days: number;
  cutoff: Date;
  /** On the live table now. */
  live: number;
  /** Of those, past the window on this run. */
  due: number;
  /** Already moved, where there is an archive to count. */
  archived: number | null;
};

async function tenantSettings(tenantId: string) {
  const t = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { auditRetentionDays: true, emailLogRetentionDays: true, notificationRetentionDays: true },
  });
  return {
    audit: t?.auditRetentionDays ?? DEFAULT_RETENTION_DAYS,
    email: t?.emailLogRetentionDays ?? 1095,
    notifications: t?.notificationRetentionDays ?? 180,
  };
}

/** The tenant's companies, since email is kept per company rather than per tenant. */
const companyIds = async (tenantId: string) =>
  (await db.company.findMany({ where: { tenantId }, select: { id: true } })).map((c) => c.id);

/**
 * Sent-email records past the window, moved a batch at a time.
 *
 * The copy and the delete are one transaction, in that order, for the same
 * reason the audit archive does it that way: a crash between them would lose
 * the rows outright, and losing them is the one outcome this exists to prevent.
 */
export async function archiveEmailLogs(tenantId: string, now: Date = new Date()): Promise<RunResult> {
  const days = (await tenantSettings(tenantId)).email;
  const cutoff = retentionCutoff(days, now);
  const ids = await companyIds(tenantId);
  let moved = 0;
  let batches = 0;

  while (batches < ARCHIVE_MAX_BATCHES) {
    const rows = await db.emailLog.findMany({
      where: { companyId: { in: ids }, sentAt: { lt: cutoff } },
      orderBy: { sentAt: "asc" },
      take: ARCHIVE_BATCH,
    });
    if (rows.length === 0) break;

    await db.$transaction([
      db.emailLogArchive.createMany({
        data: rows.map((r) => ({
          id: r.id,
          companyId: r.companyId,
          kind: r.kind,
          entity: r.entity,
          entityId: r.entityId,
          toAddresses: r.toAddresses,
          ccAddresses: r.ccAddresses,
          subject: r.subject,
          sentAt: r.sentAt,
          sentBy: r.sentBy,
          ok: r.ok,
          error: r.error,
          messageId: r.messageId,
        })),
      }),
      db.emailLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    ]);

    moved += rows.length;
    batches += 1;
  }

  return { key: "email", moved, cutoff, days, more: batches >= ARCHIVE_MAX_BATCHES };
}

/**
 * Read notifications past the window, removed.
 *
 * Unread ones stay whatever their age: somebody who has not seen it yet is
 * precisely the person the notification is for.
 */
export async function pruneNotifications(tenantId: string, now: Date = new Date()): Promise<RunResult> {
  const days = (await tenantSettings(tenantId)).notifications;
  const cutoff = retentionCutoff(days, now);
  let moved = 0;
  let batches = 0;

  while (batches < ARCHIVE_MAX_BATCHES) {
    const rows = await db.notification.findMany({
      where: { tenantId, isRead: true, createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: ARCHIVE_BATCH,
      select: { id: true },
    });
    if (rows.length === 0) break;
    await db.notification.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    moved += rows.length;
    batches += 1;
  }

  return { key: "notifications", moved, cutoff, days, more: batches >= ARCHIVE_MAX_BATCHES };
}

/** What each policy holds now, and what the next run would move. For the screen. */
export async function dueNow(tenantId: string, now: Date = new Date()): Promise<DueRow[]> {
  const settings = await tenantSettings(tenantId);
  const ids = await companyIds(tenantId);
  const cutoffs = {
    audit: retentionCutoff(settings.audit, now),
    email: retentionCutoff(settings.email, now),
    notifications: retentionCutoff(settings.notifications, now),
  };

  const [auditLive, auditDue, auditArchived, emailLive, emailDue, emailArchived, notifLive, notifDue] = await Promise.all([
    db.auditLog.count({ where: { tenantId } }),
    db.auditLog.count({ where: { tenantId, createdAt: { lt: cutoffs.audit } } }),
    db.auditLogArchive.count({ where: { tenantId } }),
    db.emailLog.count({ where: { companyId: { in: ids } } }),
    db.emailLog.count({ where: { companyId: { in: ids }, sentAt: { lt: cutoffs.email } } }),
    db.emailLogArchive.count({ where: { companyId: { in: ids } } }),
    db.notification.count({ where: { tenantId } }),
    db.notification.count({ where: { tenantId, isRead: true, createdAt: { lt: cutoffs.notifications } } }),
  ]);

  const by: Record<PolicyKey, { live: number; due: number; archived: number | null; days: number; cutoff: Date }> = {
    audit: { live: auditLive, due: auditDue, archived: auditArchived, days: settings.audit, cutoff: cutoffs.audit },
    email: { live: emailLive, due: emailDue, archived: emailArchived, days: settings.email, cutoff: cutoffs.email },
    notifications: { live: notifLive, due: notifDue, archived: null, days: settings.notifications, cutoff: cutoffs.notifications },
  };

  return POLICIES.map((policy) => ({ policy, ...by[policy.key] }));
}
