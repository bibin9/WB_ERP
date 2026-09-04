"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, X, Search, ArrowRight } from "lucide-react";
import { articlesForPath, searchArticles } from "@/lib/help";
import HelpArticleList from "./HelpArticleList";

export default function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname();

  // Close on Escape; reset search when the panel closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const contextArticles = useMemo(() => articlesForPath(pathname), [pathname]);
  const results = useMemo(() => (q.trim() ? searchArticles(q) : null), [q]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Help for this page"
        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-line/60 hover:text-heading"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-surface shadow-panel">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2 text-heading">
                <HelpCircle className="h-5 w-5" /><h2 className="font-semibold">Help</h2>
              </div>
              <button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-paper hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-line px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9" placeholder="Search all help…" autoFocus />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {results ? (
                <>
                  <p className="mb-3 text-xs text-muted">{results.length} result{results.length === 1 ? "" : "s"}</p>
                  <HelpArticleList articles={results} defaultOpenFirst />
                </>
              ) : (
                <>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {contextArticles.length ? "For this screen" : "Help topics"}
                  </p>
                  <HelpArticleList articles={contextArticles.length ? contextArticles : []} defaultOpenFirst />
                  {contextArticles.length === 0 && (
                    <p className="px-1 py-4 text-sm text-muted">No page-specific help here — use the search above, or open the full Help Center below.</p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-line px-5 py-3">
              <Link href="/help" onClick={() => setOpen(false)} className="flex items-center justify-center gap-2 rounded-lg bg-brand-paper px-4 py-2 text-sm font-medium text-heading hover:bg-line/50">
                Open the full Help Center <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
