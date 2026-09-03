"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronRight, Lightbulb } from "lucide-react";
import type { HelpArticle } from "@/lib/help";

export default function HelpArticleList({ articles, defaultOpenFirst }: { articles: HelpArticle[]; defaultOpenFirst?: boolean }) {
  const [open, setOpen] = useState<string | null>(defaultOpenFirst && articles[0] ? articles[0].id : null);

  if (articles.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted">No help articles found.</p>;
  }

  return (
    <div className="space-y-2">
      {articles.map((a) => {
        const isOpen = open === a.id;
        return (
          <div key={a.id} className="overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => setOpen(isOpen ? null : a.id)}
              className="flex w-full items-start gap-2 bg-brand-paper px-3 py-2.5 text-left hover:bg-line/40"
            >
              <ChevronRight className={clsx("mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{a.title}</span>
                {!isOpen && <span className="block truncate text-xs text-muted">{a.summary}</span>}
              </span>
            </button>

            {isOpen && (
              <div className="space-y-3 px-4 py-3 text-sm">
                {a.body && <p className="leading-relaxed text-ink">{a.body}</p>}
                {a.steps && a.steps.length > 0 && (
                  <ol className="space-y-1.5">
                    {a.steps.map((s, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-blue/10 text-[11px] font-bold text-brand-blue-600">{i + 1}</span>
                        <span className="text-ink">{s}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {a.tip && (
                  <div className="flex items-start gap-2 rounded-lg bg-brand-gold/10 px-3 py-2 text-xs text-ink">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
                    <span><span className="font-semibold">Tip:</span> {a.tip}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
