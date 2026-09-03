import { Briefcase, UserCheck } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import ConfirmDelete from "@/components/ConfirmDelete";
import RequisitionForm from "@/components/onboarding/RequisitionForm";
import { AddCandidate, CandidateStage } from "@/components/onboarding/CandidateControls";
import OnboardingCheck from "@/components/onboarding/OnboardingCheck";
import { deleteRequisition } from "./actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

const reqStatus: Record<string, string> = {
  Open: "bg-brand-blue/10 text-brand-blue-600",
  Interviewing: "bg-brand-gold/15 text-brand-gold",
  Offered: "bg-brand-navy/10 text-brand-navy",
  Filled: "bg-brand-green/10 text-brand-green-700",
  Closed: "bg-line text-muted",
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAccess("hr.onboarding");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";

  const requisitions = companyId
    ? await db.requisition.findMany({ where: { companyId }, include: { candidates: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } })
    : [];

  // Onboarding-in-progress: employees with at least one incomplete checklist item
  const onboarding = companyId
    ? await db.employee.findMany({
        where: { companyId, onboarding: { some: { done: false } } },
        include: { onboarding: { orderBy: { order: "asc" } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div>
      <PageHeader title="HR & Admin — Onboarding" subtitle="Recruitment requisitions, candidate pipeline, hiring, and new-joiner onboarding checklists.">
        {companyId && <RequisitionForm companyId={companyId} />}
      </PageHeader>
      <HrTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      {/* Requisitions + candidates */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Briefcase className="h-4 w-4" /> Requisitions
        </h2>
        {requisitions.length === 0 && <div className="card px-6 py-8 text-center text-sm text-muted">No requisitions yet. Click “New requisition”.</div>}
        {requisitions.map((r) => (
          <div key={r.id} className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold text-ink">{r.position}</div>
                <div className="text-xs text-muted">{r.department ?? "—"} · {r.headcount} position(s) · by {r.raisedBy}</div>
              </div>
              <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", reqStatus[r.status])}>{r.status}</span>
              <ConfirmDelete action={deleteRequisition.bind(null, r.id)} label={`Delete requisition "${r.position}"?`} />
            </div>

            <div className="mt-3 divide-y divide-line rounded-lg border border-line">
              {r.candidates.length === 0 && <div className="px-3 py-2 text-xs text-muted">No candidates yet.</div>}
              {r.candidates.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    {c.email && <span className="ml-2 text-xs text-muted">{c.email}</span>}
                    {c.visaType && <span className="ml-2 rounded bg-brand-navy/5 px-1.5 py-0.5 text-[10px] text-brand-navy">{c.visaType} visa</span>}
                  </div>
                  <CandidateStage id={c.id} stage={c.stage} />
                </div>
              ))}
            </div>
            <div className="mt-2"><AddCandidate requisitionId={r.id} /></div>
          </div>
        ))}
      </div>

      {/* Onboarding checklists */}
      <div className="mt-8 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <UserCheck className="h-4 w-4" /> Onboarding in progress
        </h2>
        {onboarding.length === 0 && <div className="card px-6 py-8 text-center text-sm text-muted">No active onboarding. Hire a candidate to start one.</div>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {onboarding.map((e) => {
            const doneCount = e.onboarding.filter((i) => i.done).length;
            return (
              <div key={e.id} className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-ink">{e.name}</div>
                    <div className="text-xs text-muted">{e.empNo} · {e.designation ?? "—"}</div>
                  </div>
                  <span className="rounded-full bg-brand-gold/15 px-2.5 py-0.5 text-xs font-semibold text-brand-gold">
                    {doneCount}/{e.onboarding.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {e.onboarding.map((i) => <OnboardingCheck key={i.id} id={i.id} label={i.label} done={i.done} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
