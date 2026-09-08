"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { type HrPolicy, STATUTORY_POLICY, validatePolicy, withDefaults } from "@/lib/hrpolicy";

/**
 * One company's HR policy.
 *
 * The law is a floor, not a rule, so these numbers belong to the company rather
 * than to the code. What the company cannot do is go below the floor: a policy
 * that gives less than Decree-Law 33/2021 is refused when it is saved, with the
 * article that refuses it. Configurability that lets somebody set a twenty-day
 * leave entitlement is not a feature.
 */

type Result = { ok: boolean; error?: string; problems?: string[] };

/**
 * The policy for a company, falling back to the statutory one.
 *
 * Everything exported from a "use server" file is a server action, reachable by
 * anybody who can guess a company id — so this checks the permission and the
 * company scope like every other action here, rather than trusting that it is
 * only ever called from inside this file. A company's handbook is not secret,
 * but it is not a stranger's to read either.
 */
export async function policyFor(companyId: string): Promise<HrPolicy> {
  if (!(await allow("hr.policy", "view"))) return { ...STATUTORY_POLICY };
  const session = await getSession();
  if (!session?.companies.some((c) => c.id === companyId)) return { ...STATUTORY_POLICY };
  const existing = await db.hrPolicy.findUnique({ where: { companyId } });
  return existing ? withDefaults(existing) : { ...STATUTORY_POLICY };
}

export async function saveHrPolicy(formData: FormData): Promise<Result> {
  if (!(await allow("hr.policy", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const companyId = String(formData.get("companyId") || "");
  const company = session.companies.find((c) => c.id === companyId);
  if (!company) return { ok: false, error: "No access to this company" };

  // Read every field the policy has, so a missing box falls back to the
  // statutory figure rather than to nil.
  const proposed: Record<string, number> = {};
  for (const key of Object.keys(STATUTORY_POLICY)) {
    const raw = String(formData.get(key) ?? "").trim();
    const n = Number(raw);
    proposed[key] = raw !== "" && Number.isFinite(n) ? n : STATUTORY_POLICY[key as keyof HrPolicy];
  }

  const problems = validatePolicy(proposed as Partial<HrPolicy>);
  if (problems.length) {
    return {
      ok: false,
      error:
        problems.length === 1
          ? "One setting is below what the law allows."
          : `${problems.length} settings are outside what the law allows.`,
      problems: problems.map((p) => p.message),
    };
  }

  const notes = String(formData.get("notes") || "").trim() || null;
  const before = await db.hrPolicy.findUnique({ where: { companyId } });

  await db.hrPolicy.upsert({
    where: { companyId },
    update: { ...proposed, notes, updatedBy: session.user.name },
    create: { companyId, ...proposed, notes, updatedBy: session.user.name },
  });

  // What actually moved, so the audit trail is readable a year from now rather
  // than being "policy updated" twenty times.
  const changed: string[] = [];
  const baseline = withDefaults(before);
  for (const key of Object.keys(STATUTORY_POLICY) as (keyof HrPolicy)[]) {
    if (Math.abs(baseline[key] - proposed[key]) > 1e-9) {
      changed.push(`${key} ${baseline[key]} → ${proposed[key]}`);
    }
  }
  await audit({
    action: "Updated",
    entity: "HrPolicy",
    entityId: companyId,
    summary: changed.length
      ? `${company.code} HR policy: ${changed.join(", ")}`
      : `${company.code} HR policy saved with no change`,
  });

  // Everything that reads a rate has to be re-rendered, not just this screen.
  for (const path of ["/hr/policy", "/hr/leave", "/hr/payroll", "/hr/separation", "/hr/reports", "/hr"]) {
    revalidatePath(path);
  }
  return { ok: true };
}

/** Put one company back on the statutory figures. */
export async function resetHrPolicy(companyId: string): Promise<Result> {
  if (!(await allow("hr.policy", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const company = session?.companies.find((c) => c.id === companyId);
  if (!company) return { ok: false, error: "No access to this company" };

  await db.hrPolicy.upsert({
    where: { companyId },
    update: { ...STATUTORY_POLICY, updatedBy: session!.user.name },
    create: { companyId, ...STATUTORY_POLICY, updatedBy: session!.user.name },
  });
  await audit({
    action: "Updated",
    entity: "HrPolicy",
    entityId: companyId,
    summary: `${company.code} HR policy reset to the statutory minimums`,
  });
  revalidatePath("/hr/policy");
  return { ok: true };
}

/**
 * Copy one company's policy onto another.
 *
 * A group usually runs one handbook across every entity, and re-keying twenty
 * numbers per company is how they end up differing by accident.
 */
export async function copyHrPolicy(fromCompanyId: string, toCompanyId: string): Promise<Result> {
  if (!(await allow("hr.policy", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const from = session?.companies.find((c) => c.id === fromCompanyId);
  const to = session?.companies.find((c) => c.id === toCompanyId);
  if (!from || !to) return { ok: false, error: "No access to one of those companies" };
  if (fromCompanyId === toCompanyId) return { ok: false, error: "That is the same company" };

  const source = await policyFor(fromCompanyId);
  await db.hrPolicy.upsert({
    where: { companyId: toCompanyId },
    update: { ...source, updatedBy: session!.user.name },
    create: { companyId: toCompanyId, ...source, updatedBy: session!.user.name },
  });
  await audit({
    action: "Updated",
    entity: "HrPolicy",
    entityId: toCompanyId,
    summary: `${to.code} HR policy copied from ${from.code}`,
  });
  revalidatePath("/hr/policy");
  return { ok: true };
}
