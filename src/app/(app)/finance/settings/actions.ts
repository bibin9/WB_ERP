"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow, allowIn } from "@/lib/guard";
import { audit } from "@/lib/audit";
import {
  type FinancePolicy,
  ACCOUNT_ROLES,
  DEFAULT_FINANCE_POLICY,
  validateFinancePolicy,
  withFinanceDefaults,
  parseAccounts,
} from "@/lib/financepolicy";

/**
 * One company's finance settings.
 *
 * The chart mapping is the part that matters most: until now every posting
 * named a literal code, so a customer with their own ledger could not use the
 * system without renumbering it. A role points at whatever code they actually
 * use, and the mapping is checked against their chart before it is saved — a
 * role pointing at an account that does not exist fails at the moment somebody
 * clicks Save on a voucher, which is the worst time to find out.
 */

type Result = { ok: boolean; error?: string; problems?: string[] };

const NUMBERS = [
  "vatRate", "corporateTaxRate", "corporateTaxBand", "sbrRevenueCap",
  "lossReliefCap", "filingMonths", "chequeStaleDays", "defaultRetentionPercent",
  "expiryWarningDays", "pageSize",
] as const;

export async function saveFinancePolicy(formData: FormData): Promise<Result> {
  if (!(await allow("finance.settings", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const companyId = String(formData.get("companyId") || "");
  const company = session.companies.find((c) => c.id === companyId);
  if (!company) return { ok: false, error: "No access to this company" };

  const proposed: Record<string, unknown> = {};
  for (const key of NUMBERS) {
    const raw = String(formData.get(key) ?? "").trim();
    const n = Number(raw);
    proposed[key] = raw !== "" && Number.isFinite(n) ? n : DEFAULT_FINANCE_POLICY[key];
  }
  const accounts: Record<string, string> = {};
  for (const role of ACCOUNT_ROLES) {
    accounts[role.key] = String(formData.get(`accounts.${role.key}`) ?? "").trim() || role.code;
  }
  proposed.accounts = accounts;

  const problems = validateFinancePolicy(proposed as Partial<FinancePolicy>);

  // A mapping that names an account this company does not have would fail at
  // the moment a voucher is saved. Check it here, while somebody is looking.
  const codes = [...new Set(Object.values(accounts))];
  const existing = await db.chartOfAccount.findMany({
    where: { companyId, code: { in: codes } },
    select: { code: true },
  });
  const have = new Set(existing.map((a) => a.code));
  for (const role of ACCOUNT_ROLES) {
    if (!have.has(accounts[role.key])) {
      problems.push({
        key: `accounts.${role.key}`,
        message: `${role.label} points at ${accounts[role.key]}, which is not in ${company.code}'s chart. Add it under Ledgers, or point the role at a code you already use.`,
      });
    }
  }

  if (problems.length) {
    return {
      ok: false,
      error: problems.length === 1 ? "One setting needs fixing." : `${problems.length} settings need fixing.`,
      problems: problems.map((p) => p.message),
    };
  }

  const before = await db.financePolicy.findUnique({ where: { companyId } });

  // Identifiers rather than figures: they are dictated by an accredited service
  // provider, so they are stored as typed and never parsed as numbers. Blank is
  // a meaningful value — it means eInvoicing is not switched on for this
  // company, which is the correct state until a provider has been appointed.
  const TEXTS = ["eInvoiceProvider", "eInvoiceCustomizationId", "eInvoiceProfileId"] as const;
  const texts = Object.fromEntries(
    TEXTS.map((k) => [k, String(formData.get(k) ?? "").trim().slice(0, 200)]),
  ) as Record<(typeof TEXTS)[number], string>;

  const data = {
    ...Object.fromEntries(NUMBERS.map((k) => [k, proposed[k] as number])),
    ...texts,
    accounts: JSON.stringify(accounts),
    notes: String(formData.get("notes") || "").trim() || null,
    updatedBy: session.user.name,
  };
  await db.financePolicy.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
  });

  // What actually moved, so the trail reads rather than saying "updated".
  const baseline = withFinanceDefaults(
    before ? { ...before, accounts: parseAccounts(before.accounts) as never } : null
  );
  const changed: string[] = [];
  for (const k of NUMBERS) {
    if (Math.abs(baseline[k] - (proposed[k] as number)) > 1e-9) changed.push(`${k} ${baseline[k]} → ${proposed[k]}`);
  }
  for (const role of ACCOUNT_ROLES) {
    if (baseline.accounts[role.key] !== accounts[role.key]) {
      changed.push(`${role.label} ${baseline.accounts[role.key]} → ${accounts[role.key]}`);
    }
  }
  // Switching eInvoicing on or off, or changing who transmits, is exactly the
  // kind of change somebody will later need to date.
  for (const k of TEXTS) {
    const was = (baseline as Record<string, unknown>)[k];
    if (String(was ?? "") !== texts[k]) {
      changed.push(`${k} ${was ? `“${was}”` : "(blank)"} → ${texts[k] ? `“${texts[k]}”` : "(blank)"}`);
    }
  }
  await audit({
    action: "Updated",
    entity: "FinancePolicy",
    entityId: companyId,
    summary: changed.length
      ? `${company.code} finance settings: ${changed.join(", ")}`
      : `${company.code} finance settings saved with no change`,
  });

  // Anything that reads a rate or an account code has to be re-rendered.
  for (const path of [
    "/finance/settings", "/finance/vat", "/finance/retention", "/finance/cheques",
    "/finance/corporate-tax", "/finance/reports", "/finance", "/hr/payroll", "/hr/reports",
  ]) {
    revalidatePath(path);
  }
  return { ok: true };
}

/** Put a company back on the defaults this system ships with. */
export async function resetFinancePolicy(companyId: string): Promise<Result> {
  if (!(await allow("finance.settings", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const company = session?.companies.find((c) => c.id === companyId);
  if (!company) return { ok: false, error: "No access to this company" };

  const data = {
    ...Object.fromEntries(NUMBERS.map((k) => [k, DEFAULT_FINANCE_POLICY[k]])),
    accounts: JSON.stringify(DEFAULT_FINANCE_POLICY.accounts),
    updatedBy: session!.user.name,
  };
  await db.financePolicy.upsert({ where: { companyId }, update: data, create: { companyId, ...data } });
  await audit({
    action: "Updated",
    entity: "FinancePolicy",
    entityId: companyId,
    summary: `${company.code} finance settings reset to the shipped defaults`,
  });
  revalidatePath("/finance/settings");
  return { ok: true };
}

/** Copy one company's settings onto another — a group usually shares a chart. */
export async function copyFinancePolicy(fromCompanyId: string, toCompanyId: string): Promise<Result> {
  if (!(await allow("finance.settings", "edit"))) return { ok: false, error: "Not authorised" };
  const session = await getSession();
  const from = session?.companies.find((c) => c.id === fromCompanyId);
  const to = session?.companies.find((c) => c.id === toCompanyId);
  if (!from || !to) return { ok: false, error: "No access to one of those companies" };
  if (fromCompanyId === toCompanyId) return { ok: false, error: "That is the same company" };

  const source = await db.financePolicy.findUnique({ where: { companyId: fromCompanyId } });
  const policy = withFinanceDefaults(
    source ? { ...source, accounts: parseAccounts(source.accounts) as never } : null
  );

  // The other company has its own chart, so a mapping that works here may not
  // work there. Say which codes are missing rather than copying a broken map.
  const codes = [...new Set(Object.values(policy.accounts))];
  const there = await db.chartOfAccount.findMany({
    where: { companyId: toCompanyId, code: { in: codes } },
    select: { code: true },
  });
  const have = new Set(there.map((a) => a.code));
  const missing = ACCOUNT_ROLES.filter((r) => !have.has(policy.accounts[r.key]));
  if (missing.length) {
    return {
      ok: false,
      error: `${to.code} has no account for ${missing.map((m) => `${m.label} (${policy.accounts[m.key]})`).join(", ")}. Add them under Ledgers first — the mapping would not work there.`,
    };
  }

  const data = {
    ...Object.fromEntries(NUMBERS.map((k) => [k, policy[k]])),
    accounts: JSON.stringify(policy.accounts),
    updatedBy: session!.user.name,
  };
  await db.financePolicy.upsert({ where: { companyId: toCompanyId }, update: data, create: { companyId: toCompanyId, ...data } });
  await audit({
    action: "Updated",
    entity: "FinancePolicy",
    entityId: toCompanyId,
    summary: `${to.code} finance settings copied from ${from.code}`,
  });
  revalidatePath("/finance/settings");
  return { ok: true };
}

/**
 * Lock the books up to a date: nothing can be posted on or before it.
 *
 * The lock lived only on the company record, which only a Director or the
 * Group Admin can edit — so the Finance Controller, who files the VAT return
 * and whose job it is to close the period, could not close it. Now anyone with
 * Approve on Finance Settings can set it here, for their own companies.
 *
 * A lock is set after a filing, so it may not be in the future: a lock on a
 * date not yet reached would refuse today's own postings. Moving it earlier
 * reopens a closed period, which is sometimes needed and always recorded.
 */
export async function setBooksLock(companyId: string, date: string): Promise<Result> {
  const session = await allowIn(companyId, "finance.settings", "approve");
  if (!session) return { ok: false, error: "Only someone with Approve on Finance Settings can lock the books." };
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true, booksLockedTo: true } });
  if (!company) return { ok: false, error: "Not found" };

  const value = String(date ?? "").trim();
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: "Choose a date." };
  const lockTo = value ? new Date(value + "T23:59:59.999Z") : null;
  if (lockTo && lockTo.getTime() > Date.now()) {
    return { ok: false, error: "Lock only a period that has ended. A lock on a future date would refuse today's own postings." };
  }

  const before = company.booksLockedTo ? company.booksLockedTo.toISOString().slice(0, 10) : null;
  await db.company.update({ where: { id: companyId }, data: { booksLockedTo: lockTo } });
  const reopened = before && (!value || value < before);
  await audit({
    action: "Updated",
    entity: "Company",
    entityId: companyId,
    summary: !value
      ? `Books unlocked for ${company.code} (were locked to ${before})`
      : reopened
        ? `Books reopened for ${company.code}: lock moved back from ${before} to ${value}`
        : `Books locked to ${value} for ${company.code}${before ? ` (was ${before})` : ""}`,
  });
  revalidatePath("/finance/settings");
  revalidatePath("/companies");
  return { ok: true };
}
