"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ShieldQuestion } from "lucide-react";

const HORIZONS = [
  { weeks: 4, label: "4 weeks" },
  { weeks: 8, label: "8 weeks" },
  { weeks: 13, label: "13 weeks" },
  { weeks: 26, label: "6 months" },
];

/**
 * How far ahead, and how much to believe.
 *
 * Both live in the query string rather than component state, so the server does
 * the sums and a link to a particular view is a link to that view — the same
 * choice the grid pagers make.
 */
export default function CashFlowControls({ weeks, cautious }: { weeks: number; cautious: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.push(`${pathname}?${q.toString()}`);
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
      <div className="flex flex-wrap gap-1">
        {HORIZONS.map((h) => (
          <button
            key={h.weeks}
            type="button"
            onClick={() => go({ weeks: String(h.weeks) })}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs transition-colors",
              weeks === h.weeks
                ? "bg-brand-navy text-white"
                : "border border-line text-muted hover:bg-brand-paper hover:text-ink",
            )}
          >
            {h.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => go({ cautious: cautious ? "0" : "1" })}
        aria-pressed={cautious}
        className={clsx(
          "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors",
          cautious ? "bg-brand-gold/20 text-ink" : "border border-line text-muted hover:bg-brand-paper hover:text-ink",
        )}
      >
        <ShieldQuestion className="h-3.5 w-3.5" />
        {cautious ? "Cautious view on" : "Cautious view"}
      </button>

      <span className="text-xs text-muted">
        {cautious
          ? "Money you are owed but cannot be sure of is left out. Money you owe is not."
          : "Counts everything due, including overdue invoices that may not arrive."}
      </span>
    </div>
  );
}
