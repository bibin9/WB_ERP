import Link from "next/link";
import { ArrowRight, Inbox, Settings2 } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import RaiseRequestForm from "@/components/RaiseRequestForm";
import ApprovalDecision from "@/components/ApprovalDecision";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { listDocTypes } from "@/lib/approval-engine";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

const statusBadge: Record<string, string> = {
  Pending: "bg-brand-gold/15 text-brand-gold",
  Approved: "bg-brand-green/10 text-brand-green-700",
  Rejected: "bg-red-50 text-red-600",
};

const stepColor: Record<string, string> = {
  Approved: "border-brand-green bg-brand-green/10 text-brand-green-700",
  Rejected: "border-red-200 bg-red-50 text-red-600",
  Pending: "border-line bg-white text-muted",
  Current: "border-brand-blue bg-brand-blue/10 text-brand-blue-600",
};

function money(a: number | null, c: string) {
  return a == null ? "—" : `${c} ${a.toLocaleString()}`;
}

export default async function ApprovalsPage() {
  await requireAccess("approvals.inbox");
  const session = await getSession();
  const companyIds = session?.companies.map((c) => c.id) ?? [];

  const requests = await db.approvalRequest.findMany({
    where: { companyId: { in: companyIds } },
    include: { company: true, steps: { orderBy: { order: "asc" } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // "My queue": the current pending step of any request, where I have authority in that company.
  const myQueue = requests.filter((r) => {
    if (r.status !== "Pending") return false;
    const step = r.steps.find((s) => s.order === r.currentStep);
    const m = session?.companies.find((c) => c.id === r.companyId);
    return step && m && m.approvalLevel >= step.requiredLevel;
  });

  const companyOpts = (session?.companies ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }));
  const docTypes = session ? await listDocTypes(session.tenant.id) : [];

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="One configurable sign-off engine, reused across the whole ERP."
      >
        <Link href="/settings/approvals" className="btn-ghost border border-line">
          <Settings2 className="h-4 w-4" /> Configure routes
        </Link>
        <RaiseRequestForm companies={companyOpts} docTypes={docTypes} />
      </PageHeader>

      {/* My queue */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Inbox className="h-4 w-4 text-brand-blue-600" />
          <h2 className="font-semibold text-brand-navy">My pending approvals</h2>
          <span className="ml-auto rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-semibold text-brand-blue-600">
            {myQueue.length}
          </span>
        </div>
        {myQueue.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nothing waiting for you. 🎉</p>
        ) : (
          <div className="divide-y divide-line">
            {myQueue.map((r) => {
              const step = r.steps.find((s) => s.order === r.currentStep)!;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{r.title}</div>
                    <div className="text-xs text-muted">
                      {r.docType} · {r.company.code} · {money(r.amount, r.currency)} · by {r.requestedBy} · needs {step.roleName}
                    </div>
                  </div>
                  <ApprovalDecision stepId={step.id} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All requests */}
      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-brand-navy">All requests</h2>
        </div>
        <div className="divide-y divide-line">
          {requests.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted">
              No approval requests yet. Click “Raise for approval” to try the workflow.
            </p>
          )}
          {requests.map((r) => (
            <div key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.title}</div>
                  <div className="text-xs text-muted">
                    {r.docType} · {r.company.code} · {money(r.amount, r.currency)} · by {r.requestedBy}
                  </div>
                </div>
                <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", statusBadge[r.status])}>
                  {r.status}
                </span>
              </div>
              {/* Step route */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {r.steps.map((s, i) => {
                  const isCurrent = r.status === "Pending" && s.order === r.currentStep;
                  const tone = s.status !== "Pending" ? stepColor[s.status] : isCurrent ? stepColor.Current : stepColor.Pending;
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <span className={clsx("rounded-md border px-2 py-1 text-xs", tone)} title={s.comment ?? ""}>
                        {s.roleName}
                        {s.status === "Approved" && " ✓"}
                        {s.status === "Rejected" && " ✕"}
                      </span>
                      {i < r.steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-line" />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
