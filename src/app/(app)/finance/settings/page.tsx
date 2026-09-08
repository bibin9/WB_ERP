import { Settings2, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import FinanceTabs from "@/components/FinanceTabs";
import CompanyPicker from "@/components/CompanyPicker";
import FinanceSettingsForm from "@/components/finance/FinanceSettingsForm";
import { requireAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  ACCOUNT_ROLES, DEFAULT_FINANCE_POLICY, STATUTORY_NOTE,
  financeChanges, parseAccounts, withFinanceDefaults,
} from "@/lib/financepolicy";

export const dynamic = "force-dynamic";

/**
 * Finance settings, per company.
 *
 * Two different things live here for two different reasons. The chart mapping
 * is the customer's own ledger — a contractor who has run Tally for fifteen
 * years has salaries on 5010, not 6000, and telling them to renumber it to suit
 * the software is not an answer. The tax rates are the law's, and the law moves:
 * a rate only a developer can change is a rate that will be wrong the week it
 * changes.
 *
 * What is not here is arithmetic. Debits equal credits; that is not a setting.
 */
export default async function FinanceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAccess("finance.settings");
  const session = await getSession();
  const sp = await searchParams;
  const accessible = session?.companies ?? [];
  const companyId = accessible.find((c) => c.id === sp.c)?.id ?? accessible[0]?.id ?? "";
  const company = accessible.find((c) => c.id === companyId);

  const stored = companyId ? await db.financePolicy.findUnique({ where: { companyId } }) : null;
  const policy = withFinanceDefaults(
    stored ? { ...stored, accounts: parseAccounts(stored.accounts) as never } : null
  );
  const changes = financeChanges(policy);

  // The company's actual chart, so the mapping can be picked rather than typed
  // and a code that does not exist is impossible to choose.
  const chart = companyId
    ? await db.chartOfAccount.findMany({
        where: { companyId },
        orderBy: { code: "asc" },
        select: { code: true, name: true, type: true },
      })
    : [];

  // Any role pointing at an account this company does not have. A posting would
  // fail the moment somebody saved a voucher.
  const codes = new Set(chart.map((a) => a.code));
  const broken = ACCOUNT_ROLES.filter((r) => !codes.has(policy.accounts[r.key]));

  const others = accessible
    .filter((c) => c.id !== companyId)
    .map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <div>
      <PageHeader
        title="Finance — Settings"
        subtitle="Which of your accounts the system posts to, the tax rates it applies, and the everyday thresholds."
      />
      <FinanceTabs companyId={companyId} />

      <div className="mb-5">
        <CompanyPicker companies={accessible.map((c) => ({ id: c.id, code: c.code, name: c.name }))} current={companyId} />
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-blue/40 bg-brand-blue/5 px-4 py-3 text-sm text-ink">
        <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue-600" />
        <div>
          <span className="font-semibold">Your chart, not ours.</span> Every place the system posts is a
          role &mdash; &ldquo;where wages go&rdquo;, &ldquo;where the bank is&rdquo; &mdash; pointing at
          whatever code you actually use. Nothing in the software names an account number any more, so a
          company that has run its own ledger for years does not have to renumber it. The tax rates below
          are the law as it stands today; they are settings because the law moves, and a rate only a
          developer can change is a rate that will be wrong the week it changes.
        </div>
      </div>

      {broken.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
          <div>
            <span className="font-semibold">
              {broken.length === 1 ? "One role points" : `${broken.length} roles point`} at an account{" "}
              {company?.code} does not have:
            </span>{" "}
            {broken.map((r) => `${r.label} (${policy.accounts[r.key]})`).join(", ")}. A posting that needs{" "}
            {broken.length === 1 ? "it" : "one of them"} will be refused until this is fixed &mdash; either
            add the account under Ledgers, or point the role at a code you already use.
          </div>
        </div>
      )}

      {changes.length > 0 && broken.length === 0 && (
        <p className="mb-5 text-sm text-muted">
          {company?.code} differs from the shipped defaults in {changes.length === 1 ? "one way" : `${changes.length} ways`}:{" "}
          {changes.join("; ")}.
        </p>
      )}

      {companyId && (
        <FinanceSettingsForm
          companyId={companyId}
          companyCode={company?.code ?? ""}
          policy={policy}
          defaults={DEFAULT_FINANCE_POLICY}
          notes={stored?.notes ?? ""}
          updatedBy={stored?.updatedBy ?? null}
          updatedAt={stored?.updatedAt ? stored.updatedAt.toISOString().slice(0, 10) : null}
          chart={chart}
          statutoryNote={STATUTORY_NOTE}
          others={others}
        />
      )}

      <p className="mt-4 text-xs text-muted">
        Changing a tax rate changes what future returns compute &mdash; it does not restate a VAT return or
        a corporate tax computation you have already filed, which are the record of what was declared.
        Changing an account mapping affects future postings only; vouchers already in the ledger stay where
        they were posted.
      </p>
    </div>
  );
}
