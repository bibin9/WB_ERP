/**
 * Approval matrix — the configurable sign-off routes (FSD FS-PLT-02).
 * Each document type maps to an ordered chain of approver roles with the
 * minimum approval level required. A value gate can add higher approvers.
 *
 * Sign-off hierarchy (with the Director level between Ops Manager and MD):
 *   Project Manager (50) → Operations Manager (70) → Director (80) → Managing Director (90)
 *
 * This is where a customer configures their own approval routes (product).
 */

export type ApprovalLevelDef = { role: string; level: number };

export type DocTypeRule = {
  base: ApprovalLevelDef[];
  /** If amount exceeds `over`, append these approvers. */
  valueGate?: { over: number; add: ApprovalLevelDef[] };
};

export const APPROVAL_MATRIX: Record<string, DocTypeRule> = {
  "Purchase Order": {
    base: [
      { role: "Project Manager", level: 50 },
      { role: "Operations Manager", level: 70 },
      { role: "Director", level: 80 },
    ],
    valueGate: { over: 50000, add: [{ role: "Managing Director", level: 90 }] },
  },
  Expense: {
    base: [
      { role: "Operations Manager", level: 70 },
      { role: "Director", level: 80 },
    ],
  },
  "Company Onboarding": {
    base: [
      { role: "Director", level: 80 },
      { role: "Managing Director", level: 90 },
    ],
  },
  "Leave Request": {
    base: [{ role: "Operations Manager", level: 70 }],
  },
};

export const DOC_TYPES = Object.keys(APPROVAL_MATRIX);

/** Build the ordered route for a document type + amount. */
export function buildRoute(docType: string, amount?: number | null): ApprovalLevelDef[] {
  const rule = APPROVAL_MATRIX[docType];
  if (!rule) return [{ role: "Director", level: 80 }];
  const steps = [...rule.base];
  if (rule.valueGate && amount != null && amount > rule.valueGate.over) {
    steps.push(...rule.valueGate.add);
  }
  return steps;
}
