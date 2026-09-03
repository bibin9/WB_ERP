import { AlertCircle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import JobForm from "@/components/JobForm";
import JobStatus from "@/components/JobStatus";
import ConfirmDelete from "@/components/ConfirmDelete";
import { deleteJob } from "@/app/(app)/hr/actions";
import { db } from "@/lib/db";
import { activeTenant } from "@/config/tenant";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—";
}

const prioColor: Record<string, string> = {
  Urgent: "text-red-600",
  High: "text-brand-gold",
  Normal: "text-muted",
  Low: "text-muted/70",
};

export default async function TasksPage() {
  await requireAccess("hr.tasks");
  const tenant = await db.tenant.findUnique({ where: { key: activeTenant.key } });
  const companies = tenant
    ? await db.company.findMany({ where: { tenantId: tenant.id }, orderBy: { code: "asc" } })
    : [];
  const jobs = await db.jobAssignment.findMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
    include: { company: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const open = jobs.filter((j) => j.status !== "Closed").length;

  return (
    <div>
      <PageHeader
        title="HR & Admin"
        subtitle="Assign jobs to a department or person, track progress, and close them as tickets."
      >
        <JobForm companies={companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />
      </PageHeader>
      <HrTabs />

      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <AlertCircle className="h-4 w-4 text-brand-blue-600" />
        {open} open · {jobs.length} total assignments (stored in the database)
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-brand-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Ticket</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Assigned to</th>
                <th className="px-4 py-3 font-semibold">Priority</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    No assignments yet. Click “New assignment” to create one.
                  </td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-brand-paper/60">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-brand-navy">{j.ticketNo}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{j.title}</div>
                    {j.description && <div className="text-xs text-muted">{j.description}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-brand-navy/5 px-2 py-0.5 text-xs font-medium text-brand-navy">{j.company.code}</span>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {j.assignedTo}
                    <span className="ml-1 text-xs text-muted">({j.assignedToType})</span>
                  </td>
                  <td className={`px-4 py-3 font-medium ${prioColor[j.priority] ?? "text-muted"}`}>{j.priority}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDate(j.dueDate)}</td>
                  <td className="px-4 py-3"><JobStatus id={j.id} status={j.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <JobForm
                        companies={companies.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
                        job={{
                          id: j.id, title: j.title, description: j.description, priority: j.priority,
                          assignedTo: j.assignedTo, assignedToType: j.assignedToType,
                          timeAllocation: j.timeAllocation, dueDate: j.dueDate ? j.dueDate.toISOString() : null,
                        }}
                      />
                      <ConfirmDelete action={deleteJob.bind(null, j.id)} label={`Delete task ${j.ticketNo}?`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
