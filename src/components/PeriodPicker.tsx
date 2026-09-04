"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";

/**
 * From/to selector shared by every finance report. Writes the dates into the
 * URL so a period can be bookmarked and shared, and keeps whatever other
 * parameters the screen is using (company, selected account…).
 */
export default function PeriodPicker({
  from,
  to,
  label,
  presets = [],
}: {
  from: string;
  to: string;
  label: string;
  presets?: { label: string; from: string; to: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(nextFrom: string, nextTo: string) {
    const q = new URLSearchParams(params.toString());
    q.set("from", nextFrom);
    q.set("to", nextTo);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <div className="flex items-center gap-2 text-muted">
        <CalendarRange className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">Period</span>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted">From</label>
        <input type="date" defaultValue={from} className="input w-40" onChange={(e) => apply(e.target.value, to)} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">To</label>
        <input type="date" defaultValue={to} className="input w-40" onChange={(e) => apply(from, e.target.value)} />
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <button
                key={p.label}
                onClick={() => apply(p.from, p.to)}
                className={
                  "rounded-lg border px-2.5 py-1.5 text-xs transition-colors " +
                  (active
                    ? "border-brand-blue bg-brand-blue/10 font-medium text-brand-blue-600"
                    : "border-line text-muted hover:border-brand-blue hover:text-ink")
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <span className="ml-auto text-xs text-muted">{label}</span>
    </div>
  );
}
