import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import GuardedDelete from "@/components/GuardedDelete";
import LeaveForm from "@/components/leave/LeaveForm";
import LeaveDecision from "@/components/leave/LeaveDecision";
import { deleteLeaveRequest } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";
import ExportButton from "@/components/ExportButton";

export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const badge: Record<string, string> = {
  Pending: "bg-brand-gold/15 text-brand-gold",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
};

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("hr.leave");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const employees = companyId ? await db.employee.findMany({ where: { companyId, status: { not: "Inactive" } }, orderBy: { name: "asc" } }) : [];
  const requests = companyId
    ? await db.leaveRequest.findMany({ where: { companyId }, include: { employee: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] })
    : [];
  const leaveTypes = session?.tenant.id
    ? (await db.masterItem.findMany({ where: { tenantId: session.tenant.id, type: "Leave Type", isActive: true }, orderBy: { order: "asc" } })).map((m) => m.value)
    : [];

  return (
    <div>
      <PageHeader title="HR & Admin — Leave" subtitle="Leave requests, approvals and balances. Approving annual leave deducts the balance automatically.">
        <div className="flex flex-wrap items-center gap-2">
          {companyId && <ExportButton dataset="leave" companyId={companyId} />}
          {companyId && <LeaveForm employees={employees.map((e) => ({ id: e.id, label: `${e.empNo} — ${e.name} (${e.annualLeaveBalance}d left)` }))} leaveTypes={leaveTypes} />}
        </div>
      </PageHeader>
      <HrTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Requests */}
        <div className="card lg:col-span-2 overflow-hidden">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Leave requests</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase text-muted">
                  <th className="px-4 py-2 font-semibold">Employee</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Dates</th>
                  <th className="px-4 py-2 text-center font-semibold">Days</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {requests.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No leave requests yet.</td></tr>}
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-ink">{r.employee.name}</td>
                    <td className="px-4 py-2 text-muted">{r.type}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt(r.fromDate)} – {fmt(r.toDate)}</td>
                    <td className="px-4 py-2 text-center tabular-nums">{r.days}</td>
                    <td className="px-4 py-2"><span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", badge[r.status])}>{r.status}</span></td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "Pending" && <LeaveDecision id={r.id} />}
                        <GuardedDelete screen="hr.leave" action={deleteLeaveRequest.bind(null, r.id)} label="Delete this leave request?" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Balances */}
        <div className="card">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold text-heading">Annual leave balances</h2></div>
          <div className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {employees.length === 0 && <p className="px-5 py-6 text-sm text-muted">No employees.</p>}
            {employees.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="flex-1 truncate text-sm text-ink">{e.name}</span>
                <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", e.annualLeaveBalance <= 5 ? "bg-red-50 text-red-600" : "bg-brand-green/10 text-brand-green-700")}>
                  {e.annualLeaveBalance} days
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
