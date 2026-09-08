"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { openReturn } from "@/app/(app)/finance/corporate-tax/actions";
import { financialYear, dueDate } from "@/lib/corporatetax";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pretty = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * Open a tax period.
 *
 * The tax period is the financial year, so the form works it out from the
 * company's year start rather than asking somebody to remember whether their
 * July year ends on the 30th or the 31st of June. The dates stay editable, for
 * the short first period a new company has.
 */
export default function OpenTaxPeriod({
  companyId,
  fyStartMonth,
  suggestYear,
}: {
  companyId: string;
  fyStartMonth: number;
  suggestYear: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [year, setYear] = useState(suggestYear);

  const fy = financialYear(fyStartMonth, year);
  const [from, setFrom] = useState(iso(fy.from));
  const [to, setTo] = useState(iso(fy.to));

  const chooseYear = (y: number) => {
    setYear(y);
    const next = financialYear(fyStartMonth, y);
    setFrom(iso(next.from));
    setTo(iso(next.to));
  };

  const due = /^\d{4}-\d{2}-\d{2}$/.test(to) ? dueDate(new Date(to + "T00:00:00.000Z")) : null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Open a tax period
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Open a corporate tax period</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await openReturn(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not open the period");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            A tax period is your financial year. One return covers it, and it goes to the FTA through EmaraTax within
            nine months of the year ending. This screen works out the figure for you &mdash; it does not send anything.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Financial year</label>
            <div className="flex flex-wrap gap-2">
              {[suggestYear - 1, suggestYear, suggestYear + 1].map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => chooseYear(y)}
                  className={
                    year === y
                      ? "rounded border border-brand-green bg-brand-green/10 px-3 py-1.5 text-sm font-medium text-brand-green-700"
                      : "rounded border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
                  }
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Period starts</label>
              <input
                name="periodFrom"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Period ends</label>
              <input
                name="periodTo"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input"
                required
              />
            </div>
          </div>

          {due && (
            <p className="text-xs text-muted">
              The return and the payment are both due by{" "}
              <span className="font-medium text-ink">{pretty(due)}</span>. Filing late costs AED 500 a month for the
              first year, then AED 1,000 a month.
            </p>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Opening…" : "Open the period"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
