"use client";

import { useState } from "react";
import { RotateCcw, Copy } from "lucide-react";
import {
  saveFinancePolicy, resetFinancePolicy, copyFinancePolicy,
} from "@/app/(app)/finance/settings/actions";
import { type FinancePolicy, ACCOUNT_ROLES, validateFinancePolicy } from "@/lib/financepolicy";

/**
 * The chart mapping and the rates, as a form.
 *
 * The mapping is a dropdown of the company's real chart rather than a free-text
 * box, because a typed code that does not exist is only discovered when a
 * voucher refuses to save — and by then somebody is halfway through a payment
 * run and blames the software.
 */

type Account = { code: string; name: string; type: string };

const RATE_GROUPS = [
  {
    title: "Tax",
    blurb:
      "The law as it stands today. These are settings because rates move — Small Business Relief has already been extended once — not because a company may choose its own. Changing one changes what future returns compute.",
    keys: ["vatRate", "corporateTaxRate", "corporateTaxBand", "sbrRevenueCap", "lossReliefCap", "filingMonths"],
    labels: {
      vatRate: "VAT rate",
      corporateTaxRate: "Corporate tax rate",
      corporateTaxBand: "Corporate tax nil band (AED)",
      sbrRevenueCap: "Small Business Relief cap (AED)",
      lossReliefCap: "Loss relief cap",
      filingMonths: "Filing deadline (months)",
    } as Record<string, string>,
  },
  {
    title: "Everyday thresholds",
    blurb: "Company preference and ordinary practice rather than law. Set them to whatever your business actually does.",
    keys: ["payrollDayOfMonth", "chequeStaleDays", "defaultRetentionPercent", "expiryWarningDays", "pageSize"],
    labels: {
      payrollDayOfMonth: "Payday (day of the month)",
      chequeStaleDays: "Cheque goes stale after (days)",
      defaultRetentionPercent: "Default retention (%)",
      expiryWarningDays: "Warn about expiry (days ahead)",
      pageSize: "Rows per page",
    } as Record<string, string>,
  },
];

export default function FinanceSettingsForm({
  companyId,
  companyCode,
  policy,
  defaults,
  notes,
  updatedBy,
  updatedAt,
  chart,
  statutoryNote,
  others,
}: {
  companyId: string;
  companyCode: string;
  policy: FinancePolicy;
  defaults: FinancePolicy;
  notes: string;
  updatedBy: string | null;
  updatedAt: string | null;
  chart: Account[];
  statutoryNote: Record<string, string>;
  others: { id: string; code: string; name: string }[];
}) {
  const [accounts, setAccounts] = useState<Record<string, string>>({ ...policy.accounts });
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(
      [...RATE_GROUPS[0].keys, ...RATE_GROUPS[1].keys].map((k) => [k, String(policy[k as keyof FinancePolicy])])
    )
  );
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const live = validateFinancePolicy({
    ...(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v)])) as Partial<FinancePolicy>),
    accounts: accounts as FinancePolicy["accounts"],
  });
  const badKeys = new Set(live.map((p) => p.key));

  const known = new Set(chart.map((a) => a.code));

  return (
    <form
      action={async (fd) => {
        setError("");
        setProblems([]);
        setSaving(true);
        const res = await saveFinancePolicy(fd);
        setSaving(false);
        if (res?.ok) setSaved(true);
        else {
          setError(res?.error || "Could not save");
          setProblems(res?.problems ?? []);
        }
      }}
      className="space-y-5"
    >
      <input type="hidden" name="companyId" value={companyId} />

      {/* ------------------------------------------------- the chart mapping */}
      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Where the system posts</h2>
          <p className="mt-1 text-xs text-muted">
            Each row is a place the software has to post to. Point it at the account you actually use. Two
            roles cannot share one account &mdash; the retention and VAT reconciliations compare one against
            the other.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
          {ACCOUNT_ROLES.map((role) => {
            const value = accounts[role.key] ?? role.code;
            const bad = badKeys.has(`accounts.${role.key}`) || !known.has(value);
            return (
              <div key={role.key}>
                <label className="mb-1 block text-xs font-medium text-muted">{role.label}</label>
                <select
                  name={`accounts.${role.key}`}
                  value={value}
                  onChange={(e) => {
                    setAccounts((prev) => ({ ...prev, [role.key]: e.target.value }));
                    setSaved(false);
                  }}
                  className={`input ${bad ? "border-brand-gold" : ""}`}
                >
                  {!known.has(value) && (
                    <option value={value}>{value} — not in this company&rsquo;s chart</option>
                  )}
                  {chart.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">{role.why}</p>
                {bad && (
                  <p className="mt-1 text-xs text-brand-gold">
                    {live.find((p) => p.key === `accounts.${role.key}`)?.message ??
                      `${value} is not in ${companyCode}'s chart.`}
                  </p>
                )}
                {value !== role.code && known.has(value) && (
                  <p className="mt-1 text-xs text-brand-green-700">Mapped from the default {role.code}.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* --------------------------------------------------- eInvoicing --- */}
      <div className="card">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Electronic invoicing</h2>
          <p className="mt-0.5 text-xs text-muted">
            UAE eInvoicing runs through an Accredited Service Provider — this system hands them the
            document and they validate, sign and transmit it to the FTA. These three come from that
            provider; the Ministry of Finance publishes the identifiers and revises them, so nothing
            is assumed here. Leave them blank until you have appointed one, and nothing is transmitted.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Service provider</label>
            <input name="eInvoiceProvider" defaultValue={policy.eInvoiceProvider ?? ""} className="input" placeholder="Who transmits for you" />
            <p className="mt-1 text-xs text-muted">The name on screen, so anybody can see who to ring.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Customization ID</label>
            <input name="eInvoiceCustomizationId" defaultValue={policy.eInvoiceCustomizationId ?? ""} className="input" placeholder="Given to you by your provider" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Profile ID</label>
            <input name="eInvoiceProfileId" defaultValue={policy.eInvoiceProfileId ?? ""} className="input" placeholder="Given to you by your provider" />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- the numbers */}
      {RATE_GROUPS.map((g) => (
        <div key={g.title} className="card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">{g.title}</h2>
            <p className="mt-1 text-xs text-muted">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {g.keys.map((k) => {
              const bad = badKeys.has(k);
              const differs = Number(rates[k]) !== defaults[k as keyof FinancePolicy];
              return (
                <div key={k}>
                  <label className="mb-1 block text-xs font-medium text-muted">{g.labels[k]}</label>
                  <input
                    name={k}
                    type="number"
                    step="any"
                    min="0"
                    value={rates[k] ?? ""}
                    onChange={(e) => {
                      setRates((prev) => ({ ...prev, [k]: e.target.value }));
                      setSaved(false);
                    }}
                    className={`input ${bad ? "border-brand-gold" : ""}`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {statutoryNote[k]}
                    {differs && !bad && (
                      <span className="ml-1 text-brand-gold">
                        Changed from {String(defaults[k as keyof FinancePolicy])}.
                      </span>
                    )}
                  </p>
                  {bad && <p className="mt-1 text-xs text-brand-gold">{live.find((p) => p.key === k)?.message}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="card p-5">
        <label className="mb-1 block text-sm font-medium text-ink">Why these settings</label>
        <input
          name="notes"
          defaultValue={notes}
          className="input"
          placeholder="Chart migrated from Tally, January 2026. Retention 10% per the standard subcontract."
        />
        {updatedBy && (
          <p className="mt-2 text-xs text-muted">
            Last changed by {updatedBy}
            {updatedAt ? ` on ${updatedAt}` : ""}.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-brand-gold/50 bg-brand-gold/10 px-4 py-3 text-sm text-ink">
          <p className="font-semibold">{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {saved && (
        <p className="text-sm text-brand-green-700">
          Saved. Everything posted from here on uses {companyCode}&rsquo;s accounts and rates.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving || live.length > 0} className="btn-primary">
          {saving ? "Saving…" : "Save settings"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Put ${companyCode} back on the shipped defaults?`)) return;
            setBusy(true);
            const res = await resetFinancePolicy(companyId);
            setBusy(false);
            if (res?.ok) location.reload();
            else setError(res?.error || "Could not reset");
          }}
          className="btn-ghost"
        >
          <RotateCcw className="h-4 w-4" /> Reset to defaults
        </button>

        {others.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">Copy to</span>
            {others.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Copy ${companyCode}'s finance settings onto ${o.code}?`)) return;
                  setBusy(true);
                  const res = await copyFinancePolicy(companyId, o.id);
                  setBusy(false);
                  if (!res?.ok) setError(res?.error || "Could not copy");
                  else setSaved(true);
                }}
                className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-ink"
                title={o.name}
              >
                <Copy className="mr-1 inline h-3 w-3" />
                {o.code}
              </button>
            ))}
          </div>
        )}
      </div>

      {live.length > 0 && (
        <p className="text-xs text-brand-gold">
          {live.length === 1 ? "One setting needs" : `${live.length} settings need`} fixing. Saving is held
          until they are.
        </p>
      )}
    </form>
  );
}
