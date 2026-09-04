"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, canAdminister } from "@/lib/auth";
import { allow } from "@/lib/guard";

async function guard() {
  const session = await getSession();
  if (!session || !(await canAdminister())) return null;
  return session;
}

export async function createRoute(formData: FormData) {
  if (!(await allow("settings.approvals", "create"))) return;
  const session = await guard();
  if (!session) return;
  const docType = String(formData.get("docType") || "").trim();
  if (!docType) return;
  const exists = await db.approvalRoute.findUnique({
    where: { tenantId_docType: { tenantId: session.tenant.id, docType } },
  });
  if (exists) return;
  await db.approvalRoute.create({ data: { tenantId: session.tenant.id, docType } });
  revalidatePath("/settings/approvals");
}

export async function deleteRoute(routeId: string) {
  if (!(await allow("settings.approvals", "delete"))) return;
  const session = await guard();
  if (!session) return;
  const route = await db.approvalRoute.findUnique({ where: { id: routeId } });
  if (!route || route.tenantId !== session.tenant.id) return;
  await db.approvalRoute.delete({ where: { id: routeId } });
  revalidatePath("/settings/approvals");
}

export async function addStep(formData: FormData) {
  if (!(await allow("settings.approvals", "create"))) return;
  const session = await guard();
  if (!session) return;
  const routeId = String(formData.get("routeId") || "");
  const roleId = String(formData.get("roleId") || "");
  const minRaw = String(formData.get("minAmount") || "").trim();
  const minAmount = minRaw ? Number(minRaw) : null;

  const route = await db.approvalRoute.findUnique({ where: { id: routeId }, include: { steps: true } });
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!route || route.tenantId !== session.tenant.id || !role) return;

  const nextOrder = (route.steps.reduce((m, s) => Math.max(m, s.order), 0) || 0) + 1;
  await db.approvalRouteStep.create({
    data: {
      routeId,
      order: nextOrder,
      roleName: role.name,
      requiredLevel: role.approvalLevel,
      minAmount,
    },
  });
  revalidatePath("/settings/approvals");
}

export async function removeStep(stepId: string) {
  if (!(await allow("settings.approvals", "delete"))) return;
  const session = await guard();
  if (!session) return;
  const step = await db.approvalRouteStep.findUnique({ where: { id: stepId }, include: { route: true } });
  if (!step || step.route.tenantId !== session.tenant.id) return;
  await db.approvalRouteStep.delete({ where: { id: stepId } });
  revalidatePath("/settings/approvals");
}

export async function moveStep(stepId: string, dir: "up" | "down") {
  if (!(await allow("settings.approvals", "edit"))) return;
  const session = await guard();
  if (!session) return;
  const step = await db.approvalRouteStep.findUnique({ where: { id: stepId }, include: { route: true } });
  if (!step || step.route.tenantId !== session.tenant.id) return;
  const neighbor = await db.approvalRouteStep.findFirst({
    where: {
      routeId: step.routeId,
      order: dir === "up" ? { lt: step.order } : { gt: step.order },
    },
    orderBy: { order: dir === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;
  await db.$transaction([
    db.approvalRouteStep.update({ where: { id: step.id }, data: { order: neighbor.order } }),
    db.approvalRouteStep.update({ where: { id: neighbor.id }, data: { order: step.order } }),
  ]);
  revalidatePath("/settings/approvals");
}
