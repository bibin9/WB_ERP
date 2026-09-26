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
      requestedById: session.user.id,
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

export type DecisionResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or reject the step a request is waiting on.
 *
 * Says why when it refuses. It used to return nothing, so a Project Manager
 * whose role could see the inbox but not approve in it pressed Approve and
 * watched nothing happen, with no way to tell that was a permission rather
 * than a fault.
 */
export async function decideStep(stepId: string, decision: "Approved" | "Rejected", comment: string): Promise<DecisionResult> {
  if (!(await allow("approvals.inbox", "approve"))) {
    return { ok: false, error: "Your role can see approvals but not approve them. An administrator can grant Approve on Approvals in Access Control." };
  }
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has ended. Sign in again." };

  const step = await db.approvalStep.findUnique({
    where: { id: stepId },
    include: { request: { include: { steps: true } } },
  });
  if (!step) return { ok: false, error: "That approval no longer exists." };
  const request = step.request;
  if (request.status !== "Pending" || step.order !== request.currentStep || step.status !== "Pending") {
    return { ok: false, error: "Somebody has already decided this step. Refresh to see where it has got to." };
  }

  // Authorisation: the acting user must hold, in this request's company, a role
  // whose approval level meets the step's requirement (higher authority may act).
  const membership = session.companies.find((c) => c.id === request.companyId);
  if (!membership || membership.approvalLevel < step.requiredLevel) {
    return { ok: false, error: `This step needs ${step.roleName} or above in ${membership ? "this company" : "a company you do not have access to"}.` };
  }

  // Four eyes. Whoever raised a request does not approve it, and nobody
  // decides two steps of the same one — otherwise one senior person could
  // raise a purchase order and walk it through every level alone. Older
  // requests recorded only a name, so the name is the fallback.
  const me = session.user;
  const raisedIt = request.requestedById ? request.requestedById === me.id : request.requestedBy === me.name;
  if (raisedIt) {
    return { ok: false, error: "You raised this request, so someone else has to approve it." };
  }
  const decidedBefore = request.steps.some(
    (s) => s.id !== stepId && s.status !== "Pending" && (s.decidedById ? s.decidedById === me.id : s.decidedBy === me.name),
  );
  if (decidedBefore) {
    return { ok: false, error: "You have already decided an earlier step of this request. The next step needs a different person." };
  }

  // Recorded only if the step is still waiting, in one statement: two approvers
  // pressing at the same moment used to both get through.
  const taken = await db.approvalStep.updateMany({
    where: { id: stepId, status: "Pending" },
    data: { status: decision, decidedBy: me.name, decidedById: me.id, decidedAt: new Date(), comment: comment || null },
  });
  if (taken.count === 0) {
    return { ok: false, error: "Somebody has already decided this step. Refresh to see where it has got to." };
  }

  if (decision === "Rejected") {
    await db.approvalRequest.update({ where: { id: request.id }, data: { status: "Rejected" } });
  } else {
    const isLast = step.order >= request.steps.length;
    await db.approvalRequest.updateMany({
      where: { id: request.id, status: "Pending", currentStep: request.currentStep },
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
  return { ok: true };
}

/**
 * Handing a request back to an earlier stage.
 *
 * Asked for by the client: an approver who cannot agree has two blunt options,
 * and rejecting kills the document. What is usually meant is "nearly right —
 * the site engineer should correct the quantity". So a request goes back down
 * the route, is put right, and comes back up, rather than being rejected and
 * raised again as a new document with a new number and no history.
 *
 * Everything from the target stage onwards is set waiting again, including the
 * stage doing the sending: the approvals already given above the correction
 * were given to a document that has now changed, and letting them stand would
 * mean the version that ends up approved is not the version anybody approved.
 *
 * The reason is required. A request handed back without one only goes round
 * again, and the person receiving it has to guess.
 */
export async function sendBackStep(stepId: string, toOrder: number, reason: string): Promise<DecisionResult> {
  if (!(await allow("approvals.inbox", "approve"))) {
    return { ok: false, error: "Your role can see approvals but not act on them. An administrator can grant Approve on Approvals in Access Control." };
  }
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has ended. Sign in again." };

  const said = String(reason ?? "").trim().slice(0, 500);
  if (said.length < 3) {
    return { ok: false, error: "Say what needs correcting. Whoever gets this back has only your words to go on." };
  }

  const step = await db.approvalStep.findUnique({
    where: { id: stepId },
    include: { request: { include: { steps: true } } },
  });
  if (!step) return { ok: false, error: "That approval no longer exists." };
  const request = step.request;
  if (request.status !== "Pending" || step.order !== request.currentStep || step.status !== "Pending") {
    return { ok: false, error: "Somebody has already decided this step. Refresh to see where it has got to." };
  }
  if (!Number.isInteger(toOrder) || toOrder < 1 || toOrder >= step.order) {
    return { ok: false, error: "Choose a stage before this one to send it back to." };
  }

  const membership = session.companies.find((c) => c.id === request.companyId);
  if (!membership || membership.approvalLevel < step.requiredLevel) {
    return { ok: false, error: `This step needs ${step.roleName} or above in ${membership ? "this company" : "a company you do not have access to"}.` };
  }

  const me = session.user;
  const raisedIt = request.requestedById ? request.requestedById === me.id : request.requestedBy === me.name;
  if (raisedIt) return { ok: false, error: "You raised this request, so someone else has to act on it." };

  const target = request.steps.find((s) => s.order === toOrder);
  if (!target) return { ok: false, error: "That stage is not on this route." };

  // Recorded only while this step is still the one waiting, so two approvers
  // acting at the same moment cannot both move it.
  const claimed = await db.approvalStep.updateMany({
    where: { id: stepId, status: "Pending" },
    data: { comment: said },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "Somebody has already decided this step. Refresh to see where it has got to." };
  }

  await db.$transaction([
    // Every stage from the target up, waiting again and with its old decision
    // cleared: those approvals were for the document as it was.
    db.approvalStep.updateMany({
      where: { requestId: request.id, order: { gte: toOrder } },
      data: { status: "Pending", decidedBy: null, decidedById: null, decidedAt: null },
    }),
    db.approvalRequest.update({ where: { id: request.id }, data: { currentStep: toOrder } }),
    db.approvalReturn.create({
      data: {
        requestId: request.id,
        fromOrder: step.order,
        toOrder,
        reason: said,
        sentBy: me.name,
        sentById: me.id,
      },
    }),
  ]);

  await notifyApprovers(session.tenant.id, request.companyId, target.requiredLevel, {
    title: `Sent back for correction: ${request.title}`,
    body: `${request.docType} — returned to ${target.roleName} by ${me.name}: ${said}`,
    link: "/approvals",
  });
  await audit({
    action: "Updated",
    entity: "ApprovalRequest",
    entityId: request.id,
    summary: `Sent "${request.title}" back from step ${step.order} (${step.roleName}) to step ${toOrder} (${target.roleName}): ${said}`,
  });
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true };
}
