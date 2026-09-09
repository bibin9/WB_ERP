import Link from "next/link";
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Pager from "@/components/Pager";
import AuditRetention from "@/components/AuditRetention";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import { readPaging, pageInfo } from "@/lib/paging";
import { shortAgent, AUTH_ACTIONS, retentionLabel, DEFAULT_RETENTION_DAYS } from "@/lib/auditmeta";
import { dueForArchive } from "@/lib/auditarchive";

export const dynamic = "force-dynamic";

const actionColor: Record<string, string> = {
  Created: "bg-brand-green/10 text-brand-green-700",
  Posted: "bg-brand-green/10 text-brand-green-700",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Updated: "bg-brand-blue/10 text-brand-blue-600",
  Archived: "bg-brand-blue/10 text-brand-blue-600",
  Rejected: "bg-red-50 text-red-600",
  Deleted: "bg-red-50 text-red-600",
  [AUTH_ACTIONS.signedIn]: "bg-brand-green/10 text-brand-green-700",
  [AUTH_ACTIONS.signedOut]: "bg-line text-muted",
  [AUTH_ACTIONS.failed]: "bg-amber-50 text-amber-700",
  [AUTH_ACTIONS.lockedOut]: "bg-red-50 text-red-600",
};

type Search = { p?: string; per?: string; src?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAccess("audit.log");
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const showArchive = sp.src === "archive";
  const paging = readPaging(sp);
  const where = { tenantId: session.tenant.id };

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenant.id },
    select: { auditRetentionDays: true },
  });
  const retentionDays = tenant?.auditRetentionDays ?? DEFAULT_RETENTION_DAYS;

  // Both counts, always: the tabs have to say how many are on the other side,
  // or "where did last year go?" is a support call rather than a glance.
  const [liveTotal, archiveTotal] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLogArchive.count({ where }),
  ]);
  const total = showArchive ? archiveTotal : liveTotal;
  const info = pageInfo(paging, total);
  const skip = (info.page - 1) * info.perPage;

  const logs = showArchive
    ? await db.auditLogArchive.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: info.perPage })
    : await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: info.perPage });

  const isAdmin = await canAdminister();
  const due = isAdmin ? await dueForArchive(session.tenant.id, retentionDays) : 0;

  const tab = (label: string, count: number, archive: boolean) => (
    <Link
      href={archive ? "/audit?src=archive" : "/audit"}
      className={clsx(
        "border-b-2 px-4 py-2.5 text-sm",
        showArchive === archive
          ? "border-brand-blue text-heading font-medium"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {label} <span className="text-xs text-muted">({count.toLocaleString()})</span>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="An immutable record of who did what, when, and from where."
      />

      <div className="card overflow-hidden">
        <div className="flex border-b border-line print:hidden">
          {tab("Recent", liveTotal, false)}
          {tab("Archive", archiveTotal, true)}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Details</th>
                <th className="px-4 py-3 font-semibold">From</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {showArchive
                      ? `Nothing has been archived yet. Entries move here once they are older than ${retentionLabel(retentionDays)}.`
                      : "No activity recorded yet."}
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{new Date(l.createdAt).toLocaleString("en-GB")}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink">{l.userName}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", actionColor[l.action] ?? "bg-line text-muted")}>{l.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-heading">{l.entity}</td>
                  <td className="px-4 py-2.5 text-ink">{l.summary}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                    {l.ipAddress || l.userAgent ? (
                      // The full user agent is ninety characters of version
                      // numbers; hovering shows it, the cell shows the device.
                      <span title={l.userAgent ?? ""}>
                        {l.ipAddress ?? "—"}
                        {l.userAgent ? <span className="block text-[11px]">{shortAgent(l.userAgent)}</span> : null}
                      </span>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager info={info} label={showArchive ? "archived entries" : "entries"} />
      </div>

      {isAdmin ? (
        <AuditRetention days={retentionDays} dueCount={due} archivedCount={archiveTotal} />
      ) : (
        <p className="mt-3 text-xs text-muted">
          Entries older than {retentionLabel(retentionDays)} are on the Archive tab. Nothing is ever deleted.
        </p>
      )}

      <div className="card mt-5 flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">Immutable:</span> audit entries are written
          automatically on key actions (companies, users, approvals, journal entries, employees) and
          cannot be edited or deleted — by anyone, including an administrator. Older entries move to
          the Archive tab, which is never emptied. Sign-ins, sign-outs, failed attempts and lock-outs
          are recorded here too, with the address and device they came from. An entry with no name
          you recognise is somebody typing an email address that has no account — that is normal on a
          site facing the internet; a run of them against one real account is not.
        </p>
      </div>
    </div>
  );
}
