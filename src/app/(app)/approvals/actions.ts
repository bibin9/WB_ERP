"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveRoute } from "@/lib/approval-engine";
import { notifyApprovers } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { allow } from "@/lib/guard";

export async function createApprovalRequest(formData: FormData) {
  if (!(await allow("approvals.inbox", "view"))) return;
  const session = await getSession();
  if (!session) return;

  const companyId = String(formData.get("companyId") || "");
  const docType = String(formData.get("docType") || "");
  const title = String(formData.get("title") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  if (!companyId || !docType || !title) return;

  // Only within a company the requester can access
  const canAccess = session.companies.some((c) => c.id === companyId);
  if (!canAccess) return;

  const route = await resolveRoute(session.tenant.id, docType, amount);

  const created = await db.approvalRequest.create({
    data: {
      companyId,
      docType,
      title,
      amount,
      currency: "AED",
      requestedBy: session.user.name,
      status: "Pending",
      currentStep: 1,
      steps: {
        create: route.map((r, i) => ({
          order: i + 1,
          roleName: r.role,
          requiredLevel: r.level,
          status: "Pending",
        })),
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const first = created.steps[0];
  if (first) {
    await notifyApprovers(session.tenant.id, companyId, first.requiredLevel, {
      title: `Approval needed: ${title}`,
      body: `${docType} raised by ${session.user.name}`,
      link: "/approvals",
    });
  }
  await audit({ action: "Created", entity: "ApprovalRequest", entityId: created.id, summary: `Raised ${docType} "${title}" for approval` });

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}

export async function decideStep(stepId: string, decision: "Approved" | "Rejected", comment: string) {
  if (!(await allow("approvals.inbox", "approve"))) return;
  const session = await getSession();
  if (!session) return;

  const step = await db.approvalStep.findUnique({
    where: { id: stepId },
    include: { request: { include: { steps: true } } },
  });
  if (!step) return;
  const request = step.request;
  if (request.status !== "Pending") return;
  if (step.order !== request.currentStep || step.status !== "Pending") return;

  // Authorisation: the acting user must hold, in this request's company, a role
  // whose approval level meets the step's requirement (higher authority may act).
  const membership = session.companies.find((c) => c.id === request.companyId);
  if (!membership || membership.approvalLevel < step.requiredLevel) return;

  await db.approvalStep.update({
    where: { id: stepId },
    data: { status: decision, decidedBy: session.user.name, decidedAt: new Date(), comment: comment || null },
  });

  if (decision === "Rejected") {
    await db.approvalRequest.update({ where: { id: request.id }, data: { status: "Rejected" } });
  } else {
    const isLast = step.order >= request.steps.length;
    await db.approvalRequest.update({
      where: { id: request.id },
      data: isLast ? { status: "Approved" } : { currentStep: request.currentStep + 1 },
    });
    // Notify the next level's approvers
    if (!isLast) {
      const next = request.steps.find((s) => s.order === request.currentStep + 1);
      if (next) {
        await notifyApprovers(session.tenant.id, request.companyId, next.requiredLevel, {
          title: `Approval needed: ${request.title}`,
          body: `${request.docType} — awaiting ${next.roleName}`,
          link: "/approvals",
        });
      }
    }
  }
  await audit({
    action: decision,
    entity: "ApprovalRequest",
    entityId: request.id,
    summary: `${decision} "${request.title}" at step ${step.order} (${step.roleName})`,
  });
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}
