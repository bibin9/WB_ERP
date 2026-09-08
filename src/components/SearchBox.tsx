"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * The search box above a grid.
 *
 * Puts the term on the URL and lets the server re-render, so the database does
 * the filtering. Hiding rows in the browser would only search the page you can
 * already see, which is exactly the case where you needed to search.
 *
 * Typing is debounced, because every keystroke would otherwise be a round trip
 * and a database query. Going back to page one on a new term matters too: the
 * old page four almost never exists in the new results, and landing on an empty
 * grid reads as "no matches" when there were plenty.
 */
export default function SearchBox({
  placeholder = "Search…",
  hint,
}: {
  placeholder?: string;
  /** What can be searched, in the user's words. */
  hint?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("q") ?? "";

  const [value, setValue] = useState(current);
  const first = useRef(true);

  // Follow the URL when it changes underneath us — the back button, or a link.
  useEffect(() => {
    setValue(current);
  }, [current]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (value === current) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams(params.toString());
      if (value.trim()) q.set("q", value.trim());
      else q.delete("q");
      q.delete("p"); // a new search starts at the beginning
      router.push(`${pathname}?${q.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  }, [value, current, params, pathname, router]);

  return (
    <div className="print:hidden">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input h-9 w-full py-1.5 pl-9 pr-8 text-sm sm:w-80"
        />
        {value && (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted hover:bg-line hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
