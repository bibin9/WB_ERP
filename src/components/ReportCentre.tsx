"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { REPORTS, groupReports, searchReports, type ReportDef } from "@/lib/reports";

/**
 * Every report the current user may open, in one searchable place.
 *
 * The search deliberately covers the question each report answers, not just its
 * title. "Outstanding & Ageing" is meaningless to a site engineer; typing "owes"
 * finds it. That is the difference between a directory and a list.
 *
 * Filtering is done here rather than on the server because the whole list is a
 * few dozen rows already in the page — a round trip per keystroke would be
 * slower and no more correct. The list arrives already filtered by permission.
 */
export default function ReportCentre({
  keys,
  modules,
}: {
  /** Report keys this user may open, decided on the server. */
  keys: string[];
  /** Module filter chips, with labels. */
  modules: { key: string; label: string }[];
}) {
  const [query, setQuery] = useState("");
  const [module, setModule] = useState<string>("all");

  const mine = useMemo(() => {
    const allow = new Set(keys);
    return REPORTS.filter((r) => allow.has(r.key));
  }, [keys]);

  const shown = useMemo(() => {
    const byModule = module === "all" ? mine : mine.filter((r) => r.module === module);
    return searchReports(byModule, query);
  }, [mine, module, query]);

  const groups = groupReports(shown);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] grow sm:grow-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — try “owes”, “expiry”, “VAT”, “budget”"
            aria-label="Search reports"
            className="input h-10 w-full pl-9 pr-9 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted hover:bg-line hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {[{ key: "all", label: "All" }, ...modules].map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setModule(m.key)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs transition-colors",
                module === m.key
                  ? "bg-brand-navy text-white"
                  : "border border-line text-muted hover:bg-brand-paper hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <div className="card p-10 text-center text-sm text-muted">
          {mine.length === 0
            ? "You do not have access to any reports yet. Ask an administrator to grant you a screen."
            : `Nothing matches “${query}”. Try a plainer word — “owes”, “expiry”, “hours”.`}
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.area}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g.area}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.reports.map((r) => <Card key={r.key} report={r} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ report }: { report: ReportDef }) {
  const Icon = report.icon;
  return (
    <Link
      href={report.href}
      className="card flex gap-3 p-4 transition-colors hover:border-brand-blue"
    >
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-blue/10 text-brand-blue-600">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{report.label}</span>
        {/* The question, not a description of the screen. Somebody who does not
            know the accounting word for what they want can still find it. */}
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{report.question}</span>
      </span>
    </Link>
  );
}
