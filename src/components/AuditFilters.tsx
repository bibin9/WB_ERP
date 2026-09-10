"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { FILTER_ACTIONS, type AuditFilter } from "@/lib/auditquery";

/**
 * Asking the audit trail a question.
 *
 * Everything lives in the query string rather than in component state, so a
 * filtered view can be linked, bookmarked and sent to somebody else. An auditor
 * asking "show me that" wants a URL, not a list of boxes to re-tick.
 *
 * The tab is carried through on submit. A filter that silently resets when you
 * open the archive is a filter nobody uses a second time.
 */
export default function AuditFilters({
  filter,
  users,
  entities,
  archive,
}: {
  filter: AuditFilter;
  users: string[];
  entities: string[];
  archive: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(
    Boolean(filter.user || filter.action || filter.entity || filter.from || filter.to),
  );

  const go = (next: Partial<AuditFilter>) => {
    const p = new URLSearchParams();
    const merged = { ...filter, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    if (archive) p.set("src", "archive");
    // Any change means a different set of results, so page one is the only
    // sensible place to land.
    p.delete("p");
    router.push(`/audit${p.toString() ? `?${p}` : ""}`);
  };

  const clear = () => router.push(archive ? "/audit?src=archive" : "/audit");

  const anything =
    filter.q || filter.user || filter.action || filter.entity || filter.from || filter.to;

  return (
    <div className="mb-4">
      <form
        className="flex flex-wrap items-center gap-2"
        action={(fd) => go({ q: String(fd.get("q") ?? "") })}
      >
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={filter.q}
            placeholder="Search what was done, or who did it"
            className="input pl-9"
          />
        </div>
        <button className="btn-primary">Search</button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn-ghost">
          {open ? "Fewer filters" : "More filters"}
        </button>
        {anything && (
          <button type="button" onClick={clear} className="btn-ghost text-muted">
            <X className="h-4 w-4" /> Clear
          </button>
        )}
      </form>

      {open && (
        <div className="mt-3 grid gap-3 rounded-lg border border-line bg-brand-paper p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Who</label>
            <select
              className="input h-9 py-1.5 text-sm"
              value={filter.user}
              onChange={(e) => go({ user: e.target.value })}
            >
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Did what</label>
            <select
              className="input h-9 py-1.5 text-sm"
              value={filter.action}
              onChange={(e) => go({ action: e.target.value })}
            >
              <option value="">Anything</option>
              {FILTER_ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">To what</label>
            <select
              className="input h-9 py-1.5 text-sm"
              value={filter.entity}
              onChange={(e) => go({ entity: e.target.value })}
            >
              <option value="">Any record</option>
              {entities.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">From</label>
            <input
              type="date"
              className="input h-9 py-1.5 text-sm"
              value={filter.from}
              onChange={(e) => go({ from: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">To</label>
            <input
              type="date"
              className="input h-9 py-1.5 text-sm"
              value={filter.to}
              onChange={(e) => go({ to: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted">The whole of this day is included.</p>
          </div>
        </div>
      )}
    </div>
  );
}
