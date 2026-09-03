import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

const actionColor: Record<string, string> = {
  Created: "bg-brand-green/10 text-brand-green-700",
  Posted: "bg-brand-green/10 text-brand-green-700",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Updated: "bg-brand-blue/10 text-brand-blue-600",
  Rejected: "bg-red-50 text-red-600",
  Deleted: "bg-red-50 text-red-600",
};

export default async function AuditPage() {
  await requireAccess("audit.log");
  const session = await getSession();
  if (!session) return null;

  const logs = await db.auditLog.findMany({
    where: { tenantId: session.tenant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="An immutable record of who did what and when across the system." />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No activity recorded yet.</td></tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{new Date(l.createdAt).toLocaleString("en-GB")}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink">{l.userName}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", actionColor[l.action] ?? "bg-line text-muted")}>{l.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-brand-navy">{l.entity}</td>
                  <td className="px-4 py-2.5 text-ink">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">Immutable:</span> audit entries are written
          automatically on key actions (companies, users, approvals, journal entries, employees) and
          cannot be edited or deleted.
        </p>
      </div>
    </div>
  );
}
