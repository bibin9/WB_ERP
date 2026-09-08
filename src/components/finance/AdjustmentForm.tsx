"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { addAdjustment } from "@/app/(app)/finance/corporate-tax/actions";
import { ADJUSTMENT_CATEGORIES, ADJUSTMENT_KINDS, KIND_HELP, categoryKind } from "@/lib/corporatetax";
import { money } from "@/lib/money";

/**
 * One line of the reconciliation from accounting profit to taxable income.
 *
 * The categories carry their own explanation and a worked example, because the
 * person filling this in is an accountant rather than a tax adviser and
 * "entertainment is 50% deductible" only reads as an instruction once you
 * already know the rule.
 */
export default function AdjustmentForm({ returnId }: { returnId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<string>(ADJUSTMENT_CATEGORIES[0].key);
  const [kind, setKind] = useState<string>(ADJUSTMENT_CATEGORIES[0].kind);
  const [amount, setAmount] = useState("");
  const [half, setHalf] = useState("");

  const chosen = ADJUSTMENT_CATEGORIES.find((c) => c.key === category);
  const entertainment = category === "Entertainment (50%)";
  const suggested = Math.round(((Number(half) || 0) / 2) * 100) / 100;

  const pick = (key: string) => {
    setCategory(key);
    setKind(categoryKind(key));
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Add an adjustment
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Add an adjustment</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await addAdjustment(fd);
            setSaving(false);
            if (res?.ok) {
              setOpen(false);
              setAmount("");
              setHalf("");
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="returnId" value={returnId} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Your accounts and the tax law do not agree on everything. An adjustment is one of those disagreements,
            written down with the reason &mdash; so that when the FTA asks in two years&rsquo; time, the answer is here
            rather than in somebody&rsquo;s memory.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What is it</label>
            <select name="category" value={category} onChange={(e) => pick(e.target.value)} className="input">
              {ADJUSTMENT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.key}</option>
              ))}
            </select>
            {chosen && (
              <p className="mt-1 text-xs text-muted">
                {chosen.help}
                {chosen.example ? <span className="block italic">{chosen.example}</span> : null}
              </p>
            )}
          </div>

          {entertainment && (
            <div className="rounded-lg border border-line p-3">
              <label className="mb-1 block text-xs font-medium text-muted">
                Total entertainment spent in the period
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={half}
                onChange={(e) => setHalf(e.target.value)}
                className="input h-9 py-1.5 text-sm"
                placeholder="optional — works out the half for you"
              />
              {suggested > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Half of {money(Number(half))} is <span className="font-medium text-ink">{money(suggested)}</span>.{" "}
                  <button type="button" onClick={() => setAmount(String(suggested))} className="text-brand-blue-600 underline">
                    Use that
                  </button>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Which way</label>
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
                {ADJUSTMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">{KIND_HELP[kind]}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Amount</label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                required
              />
              <p className="mt-1 text-xs text-muted">Always a positive number. Which way it goes is the box beside it.</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description</label>
            <input name="label" className="input" placeholder={category} />
            <p className="mt-1 text-xs text-muted">Left empty, this takes the name above.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Why</label>
            <input name="notes" className="input" placeholder="The reason, for whoever reads this next" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
