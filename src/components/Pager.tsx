"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES, type PageInfo } from "@/lib/paging";

/**
 * The control under a grid.
 *
 * It edits the query string and lets the server re-render, rather than holding
 * a page number in component state, so the database fetches one page instead of
 * fetching everything and hiding most of it. Every other filter already on the
 * URL — the company, the period — is preserved untouched.
 *
 * Hidden on print, and the note beside it says what the printed page actually
 * contains, because "showing 51 to 100" printed without that context is a
 * report that looks like it is missing rows.
 */
export default function Pager({ info, label = "rows" }: { info: PageInfo; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.push(`${pathname}?${q.toString()}`);
  };

  // One page and a default size is not worth a control.
  if (info.total <= PAGE_SIZES[0] && info.perPage === PAGE_SIZES[1]) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm print:hidden">
      <span className="text-muted">
        {info.total === 0 ? (
          `No ${label}`
        ) : (
          <>
            Showing <span className="font-medium text-ink">{info.from.toLocaleString()}</span> to{" "}
            <span className="font-medium text-ink">{info.to.toLocaleString()}</span> of{" "}
            <span className="font-medium text-ink">{info.total.toLocaleString()}</span> {label}
          </>
        )}
      </span>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          Per page
          <select
            value={info.perPage}
            onChange={(e) => go({ per: e.target.value, p: "1" })}
            className="input h-8 w-auto py-1 text-xs"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            disabled={!info.hasPrev}
            onClick={() => go({ p: String(info.page - 1) })}
            className="grid h-8 w-8 place-items-center rounded border border-line text-muted enabled:hover:bg-line enabled:hover:text-ink disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-xs text-muted">
            {info.page} of {info.pages}
          </span>
          <button
            disabled={!info.hasNext}
            onClick={() => go({ p: String(info.page + 1) })}
            className="grid h-8 w-8 place-items-center rounded border border-line text-muted enabled:hover:bg-line enabled:hover:text-ink disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
