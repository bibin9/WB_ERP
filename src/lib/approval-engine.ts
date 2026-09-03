import "server-only";
import { db } from "./db";

export type ResolvedStep = { role: string; level: number };

/**
 * Resolve the approval route for a document type + amount from the DB
 * (admin-configured per tenant). Steps whose `minAmount` exceeds the amount
 * are skipped, so value thresholds add higher approvers dynamically.
 */
export async function resolveRoute(
  tenantId: string,
  docType: string,
  amount?: number | null
): Promise<ResolvedStep[]> {
  const route = await db.approvalRoute.findUnique({
    where: { tenantId_docType: { tenantId, docType } },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const amt = amount ?? 0;
  const steps = (route?.steps ?? [])
    .filter((s) => s.minAmount == null || amt >= s.minAmount)
    .map((s) => ({ role: s.roleName, level: s.requiredLevel }));

  // Safety net if a route has no applicable steps configured
  if (steps.length === 0) return [{ role: "Director", level: 80 }];
  return steps;
}

/** Document types available to raise (tenant-configured). */
export async function listDocTypes(tenantId: string): Promise<string[]> {
  const routes = await db.approvalRoute.findMany({
    where: { tenantId, isActive: true },
    orderBy: { docType: "asc" },
    select: { docType: true },
  });
  return routes.map((r) => r.docType);
}
