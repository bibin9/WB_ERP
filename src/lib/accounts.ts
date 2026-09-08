import "server-only";
import { db } from "./db";
import {
  type AccountRole,
  type FinancePolicy,
  ACCOUNT_ROLES,
  parseAccounts,
  withFinanceDefaults,
} from "./financepolicy";

/**
 * Turn a posting role into this company's actual account.
 *
 * Every module used to name a number: "1160" for retention receivable, "6000"
 * for wages. That works until a customer arrives with their own chart, and
 * then it does not work at all — you cannot tell a contractor who has run the
 * same ledger for fifteen years to renumber it to suit the software.
 *
 * So a module asks for a role and gets back whatever code that company has
 * mapped it to. If nothing is mapped, the default is the code this system has
 * always used, so an existing company keeps working untouched.
 *
 * When a role points at an account that does not exist, this says so by name
 * and by role rather than returning nothing. A posting that fails with
 * "account not found" at the moment somebody clicks Save is the worst possible
 * time to discover a mapping is wrong.
 */

export type ResolvedAccounts = {
  policy: FinancePolicy;
  /** Role → the account row, where it exists in this company's chart. */
  byRole: Partial<Record<AccountRole, { id: string; code: string; name: string }>>;
  /** Roles whose mapped code is not in the chart, with the code they wanted. */
  missing: { role: AccountRole; label: string; code: string }[];
};

/** This company's finance settings, defaults filled in. */
export async function financePolicyFor(companyId: string): Promise<FinancePolicy> {
  const row = await db.financePolicy.findUnique({ where: { companyId } });
  if (!row) return withFinanceDefaults(null);
  return withFinanceDefaults({ ...row, accounts: parseAccounts(row.accounts) as never });
}

/** Every mapped account this company has, resolved in one query. */
export async function resolveAccounts(companyId: string): Promise<ResolvedAccounts> {
  const policy = await financePolicyFor(companyId);
  const codes = [...new Set(Object.values(policy.accounts))];
  const rows = await db.chartOfAccount.findMany({
    where: { companyId, code: { in: codes } },
    select: { id: true, code: true, name: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r]));

  const byRole: ResolvedAccounts["byRole"] = {};
  const missing: ResolvedAccounts["missing"] = [];
  for (const role of ACCOUNT_ROLES) {
    const code = policy.accounts[role.key];
    const found = byCode.get(code);
    if (found) byRole[role.key] = found;
    else missing.push({ role: role.key, label: role.label, code });
  }
  return { policy, byRole, missing };
}

/**
 * The accounts a particular posting needs, or a sentence saying what is wrong.
 *
 * Returning the message rather than throwing keeps the failure in the same
 * shape as every other refusal in the system — the caller hands it to the user
 * as it is, and it names the setting to fix rather than a code number.
 */
export async function accountsForPosting(
  companyId: string,
  roles: AccountRole[]
): Promise<
  | { ok: true; policy: FinancePolicy; ids: Record<string, string> }
  | { ok: false; error: string }
> {
  const { policy, byRole, missing } = await resolveAccounts(companyId);
  const wanted = missing.filter((m) => roles.includes(m.role));
  if (wanted.length) {
    const list = wanted.map((m) => `${m.label} (${m.code})`).join(", ");
    return {
      ok: false,
      error:
        `This company's chart has no account for ${list}. ` +
        "Add it under Ledgers, or point the role at a different code on Finance → Settings.",
    };
  }
  const ids: Record<string, string> = {};
  for (const r of roles) ids[r] = byRole[r]!.id;
  return { ok: true, policy, ids };
}

/** The code a role points at, for a screen that has to show one. */
export async function codeFor(companyId: string, role: AccountRole): Promise<string> {
  const policy = await financePolicyFor(companyId);
  return policy.accounts[role];
}
