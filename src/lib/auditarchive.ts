import { db } from "./db";
import { DEFAULT_RETENTION_DAYS, retentionCutoff } from "./auditmeta";

/**
 * Moving audit entries past their retention window off the live table.
 *
 * Not marked server-only, unlike audit.ts, because the deploy-time script runs
 * it outside Next. It touches nothing but the database, so there is nothing
 * request-shaped for a client bundle to pull in by accident.
 */

/**
 * How many entries move per transaction.
 *
 * The first run on a system that has been collecting for years could face
 * hundreds of thousands of rows, and one statement that size holds locks on the
 * table every sign-in is trying to write to. Batching keeps each transaction
 * short; the loop simply runs more of them.
 */
export const ARCHIVE_BATCH = 1000;

/** A ceiling on one invocation, so a boot cannot turn into an unbounded job. */
export const ARCHIVE_MAX_BATCHES = 500;

export type ArchiveResult = {
  moved: number;
  cutoff: Date;
  retentionDays: number;
  /** True when the ceiling was hit and there is more to move on the next run. */
  more: boolean;
};

/**
 * Move one tenant's expired entries into AuditLogArchive.
 *
 * The copy and the delete are one transaction, in that order. A crash between
 * them would otherwise lose the rows outright, which is the one outcome an
 * audit trail may never have — and it is why this does not simply delete.
 *
 * Because it is atomic, a half-archived row cannot exist. The only way the same
 * id is offered twice is two runs at once — the deploy-time job and somebody
 * pressing the button — and that is caught rather than prevented, since
 * `skipDuplicates` is a PostgreSQL-only option and the local database is SQLite.
 * A clash means the other run got there first, so the batch is simply re-read.
 */
export async function archiveTenant(tenantId: string, now: Date = new Date()): Promise<ArchiveResult> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { auditRetentionDays: true },
  });
  const retentionDays = tenant?.auditRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = retentionCutoff(retentionDays, now);

  let moved = 0;
  let batches = 0;
  let clashes = 0;
  for (; batches < ARCHIVE_MAX_BATCHES; batches++) {
    const due = await db.auditLog.findMany({
      where: { tenantId, createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: ARCHIVE_BATCH,
    });
    if (due.length === 0) break;

    try {
      await db.$transaction([
        db.auditLogArchive.createMany({
          data: due.map((e) => ({
            id: e.id,
            tenantId: e.tenantId,
            userId: e.userId,
            userName: e.userName,
            action: e.action,
            entity: e.entity,
            entityId: e.entityId,
            summary: e.summary,
            ipAddress: e.ipAddress,
            userAgent: e.userAgent,
            createdAt: e.createdAt,
          })),
        }),
        db.auditLog.deleteMany({ where: { id: { in: due.map((e) => e.id) } } }),
      ]);
      moved += due.length;
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
      // Another run archived these between the read and the write. Nothing is
      // lost — they are in the archive — so re-read and carry on. The counter
      // stops two runs racing each other in a tight loop indefinitely.
      if (++clashes > 5) break;
    }
  }

  return { moved, cutoff, retentionDays, more: batches >= ARCHIVE_MAX_BATCHES };
}

/** Every tenant, for the deploy-time run. */
export async function archiveAll(now: Date = new Date()): Promise<ArchiveResult[]> {
  const tenants = await db.tenant.findMany({ select: { id: true } });
  const out: ArchiveResult[] = [];
  for (const t of tenants) out.push(await archiveTenant(t.id, now));
  return out;
}

/** How many entries are waiting to be archived — for the screen to say so. */
export async function dueForArchive(tenantId: string, retentionDays: number, now: Date = new Date()) {
  return db.auditLog.count({
    where: { tenantId, createdAt: { lt: retentionCutoff(retentionDays, now) } },
  });
}
