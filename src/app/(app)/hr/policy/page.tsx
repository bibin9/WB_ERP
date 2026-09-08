import { ShieldCheck, Scale } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import HrTabs from "@/components/HrTabs";
import CompanyPicker from "@/components/CompanyPicker";
import HrPolicyForm from "@/components/hr/HrPolicyForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { STATUTORY_POLICY, withDefaults, aboveStatutory, type HrPolicy } from "@/lib/hrpolicy";

export const dynamic = "force-dynamic";

/**
 * The company's handbook, as numbers the rest of the system reads.
 *
 * Everything here used to be a constant in the code, which is fine for one
 * company and wrong for a product: three companies in a group need not run the
 * same handbook, and the next customer certainly will not. What stays fixed is
 * the floor — a policy below Decree-Law 33/2021 is refused when it is saved,
 * because letting somebody configure a twenty-day leave entitlement would not
 * be flexibility.
 */
export default async function HrPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("hr.policy");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const company = accessible.find((c) => c.id === companyId);

  const stored = companyId ? await db.hrPolicy.findUnique({ where: { companyId } }) : null;
  const policy: HrPolicy = withDefaults(stored);
  const better = aboveStatutory(policy);

  // Every other company the user can reach, so a group can run one handbook
  // instead of twenty numbers keyed three times.
  const others = accessible.filter((c) => c.id !== companyId).map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <div>
      <PageHeader
        title="HR — Policy"
        subtitle="Your handbook, as the numbers every other screen reads. Leave, probation, notice, overtime, sick pay, gratuity and the ticket."
      />
      <HrTabs />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-blue/40 bg-brand-blue/5 px-4 py-3 text-sm text-ink">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <div>
          <span className="font-semibold">The law is a floor, not a rule.</span> Thirty days of annual leave
          is the least you may give, and plenty of UAE companies give more. Set what your handbook actually
          says here and every calculation follows it &mdash; leave balances, payslips, overtime, the final
          settlement. What you cannot do is go below the statutory minimum: those are refused when you save,
          with the article that refuses them.
        </div>
      </div>

      {better.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-green/40 bg-brand-green/5 px-4 py-3 text-sm text-ink">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-green-700" />
          <div>
            <span className="font-semibold">
              {company?.code} is more generous than the law in {better.length === 1 ? "one respect" : `${better.length} respects`}:
            </span>{" "}
            {better.join("; ")}.
          </div>
        </div>
      )}

      {companyId && (
        <HrPolicyForm
          companyId={companyId}
          companyCode={company?.code ?? ""}
          policy={policy}
          statutory={STATUTORY_POLICY}
          notes={stored?.notes ?? ""}
          updatedBy={stored?.updatedBy ?? null}
          updatedAt={stored?.updatedAt ? stored.updatedAt.toISOString().slice(0, 10) : null}
          others={others}
        />
      )}

      <p className="mt-4 text-xs text-muted">
        A company that has never opened this screen runs on the statutory figures, so it is compliant by
        default. Changing a figure here takes effect on the next calculation &mdash; it does not rewrite
        payslips or settlements that have already been produced, which are the record of what was actually
        paid.
      </p>
    </div>
  );
}
