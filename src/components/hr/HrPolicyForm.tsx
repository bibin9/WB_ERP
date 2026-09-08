"use client";

import { useState } from "react";
import { RotateCcw, Copy } from "lucide-react";
import { saveHrPolicy, resetHrPolicy, copyHrPolicy } from "@/app/(app)/hr/policy/actions";
import { type HrPolicy, POLICY_RULES, validatePolicy } from "@/lib/hrpolicy";

/**
 * The handbook, as a form.
 *
 * Every box shows what the law says beside what this company says, because the
 * question an HR manager is actually asking is "am I allowed to do this?" — and
 * the validation runs as they type rather than only when they save, so a policy
 * below the floor is refused where the cursor is, not after twenty boxes.
 */

type Group = { title: string; blurb: string; keys: (keyof HrPolicy)[] };

const GROUPS: Group[] = [
  {
    title: "Annual leave",
    blurb:
      "Thirty days a year is the statutory minimum, from a year of service. Between six months and a year the law gives two days a month. The carry-forward ceiling is yours alone — the law expects leave to be taken in the year it is earned.",
    keys: ["annualLeaveDays", "leaveAccrualAfterMonths", "partYearDaysPerMonth", "carryForwardDays"],
  },
  {
    title: "Probation and notice",
    blurb:
      "Probation is six months at most and cannot be extended. Notice runs from thirty to ninety days, and fourteen while probation runs. An employee's own contract overrides the figure here.",
    keys: ["probationMonths", "probationNoticeDays", "noticeDays"],
  },
  {
    title: "Working time and overtime",
    blurb:
      "Eight hours is the longest normal day. Overtime is priced on basic pay: 125% ordinarily, 150% between 22:00 and 04:00, on a rest day or on a public holiday. The divisor turns a monthly salary into a daily one — the smaller it is, the more a day is worth.",
    keys: ["normalHoursPerDay", "daysPerMonth", "otNormalRate", "otPremiumRate"],
  },
  {
    title: "Sick pay",
    blurb:
      "Ninety days in a year of service: fifteen at full pay, thirty at half, forty-five unpaid. A handbook may pay the middle band at more than half.",
    keys: ["sickFullDays", "sickHalfDays", "sickUnpaidDays", "sickHalfPayRate"],
  },
  {
    title: "End of service",
    blurb:
      "Twenty-one days of basic per year for the first five, thirty after, capped at two years' basic pay, earned from one completed year. All four are minimums a contract may better.",
    keys: ["gratuityFirst5Days", "gratuityAfter5Days", "gratuityCapYears", "gratuityMinYears"],
  },
  {
    title: "Repatriation ticket",
    blurb:
      "Not a statutory entitlement at all — whatever the contract says. The amount here is what an employee's own record falls back to when it is blank.",
    keys: ["airTicketEveryMonths", "airTicketDefault"],
  },
];

const RULE = Object.fromEntries(POLICY_RULES.map((r) => [r.key, r])) as Record<
  keyof HrPolicy,
  (typeof POLICY_RULES)[number]
>;

export default function HrPolicyForm({
  companyId,
  companyCode,
  policy,
  statutory,
  notes,
  updatedBy,
  updatedAt,
  others,
}: {
  companyId: string;
  companyCode: string;
  policy: HrPolicy;
  statutory: HrPolicy;
  notes: string;
  updatedBy: string | null;
  updatedAt: string | null;
  others: { id: string; code: string; name: string }[];
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, String(v)]))
  );
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  // Validate as it is typed, so the refusal lands where the cursor is.
  const live = validatePolicy(
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) as Partial<HrPolicy>
  );
  const badKeys = new Set(live.map((p) => p.key));

  const set = (k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  };

  return (
    <form
      action={async (fd) => {
        setError("");
        setProblems([]);
        setSaving(true);
        const res = await saveHrPolicy(fd);
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

      {GROUPS.map((g) => (
        <div key={g.title} className="card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-semibold text-heading">{g.title}</h2>
            <p className="mt-1 text-xs text-muted">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {g.keys.map((k) => {
              const rule = RULE[k];
              const bad = badKeys.has(k);
              const differs = Number(values[k]) !== statutory[k];
              return (
                <div key={k}>
                  <label className="mb-1 block text-xs font-medium text-muted">{rule?.label ?? k}</label>
                  <input
                    name={k}
                    type="number"
                    step="0.01"
                    min="0"
                    value={values[k] ?? ""}
                    onChange={(e) => set(k, e.target.value)}
                    className={`input ${bad ? "border-brand-gold" : ""}`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {rule
                      ? `${rule.bound === "min" ? "At least" : "At most"} ${rule.limit} by law.`
                      : ""}
                    {differs && !bad && (
                      <span className="ml-1 text-brand-green-700">Yours: {values[k]}.</span>
                    )}
                  </p>
                  {bad && (
                    <p className="mt-1 text-xs text-brand-gold">
                      {live.find((pr) => pr.key === k)?.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="card p-5">
        <label className="mb-1 block text-sm font-medium text-ink">Where this comes from</label>
        <input
          name="notes"
          defaultValue={notes}
          className="input"
          placeholder="Handbook clause 4.2, agreed at the board meeting of 12 March"
        />
        <p className="mt-1 text-xs text-muted">
          Optional, and worth filling in. In two years&rsquo; time somebody will ask why the notice period
          is sixty days.
        </p>
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
          Saved. Every calculation from here on uses {companyCode}&rsquo;s figures.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving || live.length > 0} className="btn-primary">
          {saving ? "Saving…" : "Save policy"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Put ${companyCode} back on the statutory minimums?`)) return;
            setBusy(true);
            const res = await resetHrPolicy(companyId);
            setBusy(false);
            if (res?.ok) location.reload();
            else setError(res?.error || "Could not reset");
          }}
          className="btn-ghost"
        >
          <RotateCcw className="h-4 w-4" /> Reset to the law
        </button>

        {others.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">Copy this policy to</span>
            {others.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Copy ${companyCode}'s policy onto ${o.code}? It will replace whatever ${o.code} has now.`)) return;
                  setBusy(true);
                  const res = await copyHrPolicy(companyId, o.id);
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
          {live.length === 1 ? "One setting is" : `${live.length} settings are`} outside what the law allows.
          Saving is held until they are fixed.
        </p>
      )}
    </form>
  );
}
