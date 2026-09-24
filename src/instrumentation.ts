/**
 * Runs once when the server starts, before it serves anything.
 *
 * Next calls `register()` on boot. It is the only place in this application
 * where "do this every deploy" can live and still be ordinary code — a script
 * in the start chain cannot import from src/lib, because Node resolves
 * `./db` literally where TypeScript finds `db.ts`, and a deploy-time job that
 * silently never runs is worse than no job at all.
 *
 * Nothing here may stop the server coming up. Housekeeping is worth doing and
 * worth nothing beside the application starting, so every failure is logged
 * and swallowed.
 */
export async function register() {
  // Next runs this in the edge runtime too, where there is no database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { archiveAll } = await import("./lib/auditarchive");
    const { retentionLabel } = await import("./lib/auditmeta");
    const results = await archiveAll();
    const moved = results.reduce((n, r) => n + r.moved, 0);
    if (moved === 0) {
      console.log("[audit archive] nothing past its retention window.");
    } else {
      for (const r of results.filter((x) => x.moved > 0)) {
        console.log(
          `[audit archive] moved ${r.moved.toLocaleString()} entries older than ` +
            `${r.cutoff.toISOString().slice(0, 10)} (keeping ${retentionLabel(r.retentionDays)})` +
            (r.more ? " — more remain, they will move on the next start." : "."),
        );
      }
    }
  } catch (err) {
    console.error("[audit archive] skipped:", err instanceof Error ? err.message : err);
  }

  // The other two logs, on the windows set in Settings → Data Retention. Each
  // tenant separately, and each failure swallowed on its own: housekeeping for
  // one of them must not stop the rest, and none of it may stop the server.
  try {
    const { db } = await import("./lib/db");
    const { archiveEmailLogs, pruneNotifications } = await import("./lib/data-retention");
    const tenants = await db.tenant.findMany({ select: { id: true, key: true } });
    for (const t of tenants) {
      for (const job of [archiveEmailLogs, pruneNotifications]) {
        try {
          const r = await job(t.id);
          if (r.moved > 0) {
            console.log(
              `[retention:${r.key}] ${r.moved.toLocaleString()} record(s) ` +
                `${r.key === "notifications" ? "removed" : "moved to the archive"} for ${t.key}, older than ` +
                `${r.cutoff.toISOString().slice(0, 10)} (keeping ${r.days} days)` +
                (r.more ? " — more remain, they go on the next start." : "."),
            );
          }
        } catch (err) {
          console.error("[retention] one job skipped:", err instanceof Error ? err.message : err);
        }
      }
    }
  } catch (err) {
    console.error("[retention] skipped:", err instanceof Error ? err.message : err);
  }
}
