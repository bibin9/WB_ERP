/**
 * Which approval requests someone may see.
 *
 * The inbox's "All requests" listed every request in the company to anyone who
 * could open the inbox — a storekeeper could read each sales quotation's
 * customer and value, and a site engineer every purchase order. Reported from
 * use on Pre-Prod, 21 September 2026.
 *
 * You see a request if you raised it, if you decided one of its steps, or if
 * its route has a step your role could decide (and you may approve at all).
 * Directors and the Group Admin — level 80 and above — see every request, as
 * they see everything else. Older requests recorded people by name only, so
 * the name is the fallback.
 *
 * Pure, so it is tested directly (scripts/test-security-fixes.mjs).
 */

export type RequestForVisibility = {
  requestedById: string | null;
  requestedBy: string;
  steps: { requiredLevel: number; decidedById: string | null; decidedBy: string | null }[];
};

export type Viewer = {
  id: string;
  name: string;
  /** The viewer's approval level in the request's company; -1 if none. */
  level: number;
  /** Whether the viewer holds Approve on the approvals inbox. */
  mayApprove: boolean;
};

export function canSeeRequest(r: RequestForVisibility, me: Viewer): boolean {
  if (me.level < 0) return false;
  if (me.level >= 80) return true;
  const raised = r.requestedById ? r.requestedById === me.id : r.requestedBy === me.name;
  if (raised) return true;
  const decided = r.steps.some((s) => (s.decidedById ? s.decidedById === me.id : !!s.decidedBy && s.decidedBy === me.name));
  if (decided) return true;
  return me.mayApprove && r.steps.some((s) => s.requiredLevel <= me.level);
}

/**
 * Whether a request is waiting for this person to decide it now: pending, its
 * current step within their level, and not one the four-eyes rule would refuse
 * them — they did not raise it and have not decided an earlier step.
 */
export type PendingRequest = Omit<RequestForVisibility, "steps"> & {
  status: string;
  currentStep: number;
  steps: (RequestForVisibility["steps"][number] & { order: number })[];
};

export function waitingFor(r: PendingRequest, me: Viewer): boolean {
  if (r.status !== "Pending" || !me.mayApprove || me.level < 0) return false;
  const step = r.steps.find((s) => s.order === r.currentStep);
  if (!step || me.level < step.requiredLevel) return false;
  const raised = r.requestedById ? r.requestedById === me.id : r.requestedBy === me.name;
  const decidedBefore = r.steps.some((s) => s.order !== r.currentStep && (s.decidedById ? s.decidedById === me.id : !!s.decidedBy && s.decidedBy === me.name));
  return !raised && !decidedBefore;
}
