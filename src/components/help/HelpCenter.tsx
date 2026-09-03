"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { HELP_ARTICLES, HELP_CATEGORIES, searchArticles } from "@/lib/help";
import HelpArticleList from "./HelpArticleList";

export default function HelpCenter() {
  const [q, setQ] = useState("");
  const results = useMemo(() => (q.trim() ? searchArticles(q) : null), [q]);

  return (
    <div>
      <div className="relative mb-6 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="input pl-9"
          placeholder="Search help — e.g. 'reset password', 'VAT', 'attendance'…"
          autoFocus
        />
      </div>

      {results ? (
        <div className="max-w-3xl">
          <p className="mb-3 text-sm text-muted">{results.length} result{results.length === 1 ? "" : "s"} for “{q}”</p>
          <HelpArticleList articles={results} defaultOpenFirst />
        </div>
      ) : (
        <div className="space-y-8">
          {HELP_CATEGORIES.map((cat) => {
            const items = HELP_ARTICLES.filter((a) => a.category === cat);
            if (items.length === 0) return null;
            return (
              <section key={cat} className="max-w-3xl">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{cat}</h2>
                <HelpArticleList articles={items} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
