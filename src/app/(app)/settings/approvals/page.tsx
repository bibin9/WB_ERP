import Link from "next/link";
import { ArrowRight, ArrowLeft, GitBranch } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import AddRouteForm from "@/components/approval/AddRouteForm";
import AddStepRow from "@/components/approval/AddStepRow";
import StepControls from "@/components/approval/StepControls";
import DeleteRouteButton from "@/components/approval/DeleteRouteButton";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ApprovalRoutesPage() {
  await requireAccess("settings.approvals");
  const session = await getSession();
  if (!session) return null;

  const [routes, roles] = await Promise.all([
    db.approvalRoute.findMany({
      where: { tenantId: session.tenant.id },
      include: { steps: { orderBy: { order: "asc" } } },
      orderBy: { docType: "asc" },
    }),
    db.role.findMany({ where: { tenantId: session.tenant.id }, orderBy: { approvalLevel: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Approval Routes"
        subtitle="Configure the sign-off chain for each document type. Changes apply to new requests immediately — no code needed."
      >
        <AddRouteForm />
      </PageHeader>

      <Link href="/approvals" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Approvals
      </Link>

      <div className="space-y-4">
        {routes.length === 0 && (
          <div className="card px-6 py-12 text-center text-sm text-muted">
            No approval routes yet. Add a document type above to configure its sign-off chain.
          </div>
        )}

        {routes.map((route) => (
          <div key={route.id} className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-brand-blue-600" />
                <h2 className="font-semibold text-heading">{route.docType}</h2>
                <span className="text-xs text-muted">{route.steps.length} step(s)</span>
              </div>
              <DeleteRouteButton routeId={route.id} />
            </div>

            {/* Step chain */}
            {route.steps.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No approvers yet — add the first step below.</p>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {route.steps.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-brand-paper px-2.5 py-1.5 text-sm">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-navy text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="text-ink">{s.roleName}</span>
                      <span className="text-xs text-muted">L{s.requiredLevel}</span>
                      {s.minAmount != null && (
                        <span className="rounded bg-brand-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-gold">
                          ≥ {s.minAmount.toLocaleString()}
                        </span>
                      )}
                      <StepControls stepId={s.id} canUp={i > 0} canDown={i < route.steps.length - 1} />
                    </span>
                    {i < route.steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-line" />}
                  </div>
                ))}
              </div>
            )}

            <AddStepRow
              routeId={route.id}
              roles={roles.map((r) => ({ id: r.id, name: r.name, approvalLevel: r.approvalLevel }))}
            />
          </div>
        ))}
      </div>

      <div className="card mt-5 flex items-start gap-3 p-5">
        <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">How value thresholds work:</span> a step with
          “only if amount ≥ X” is added to the route only when a request&apos;s amount reaches X.
          Example: set the Managing Director step to ≥ 50,000 so only large POs need MD sign-off.
        </p>
      </div>
    </div>
  );
}
