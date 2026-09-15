"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { askVendors } from "@/app/(app)/inventory/actions";

/**
 * Inviting suppliers to quote (INV-06).
 *
 * Several at once, because asking three is the normal case and doing it one at
 * a time three times is how somebody stops at two.
 */
export default function AskVendors({
  rfqId,
  candidates,
}: {
  rfqId: string;
  candidates: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [term, setTerm] = useState("");

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const shown = term.trim()
    ? candidates.filter((c) => (c.name + c.code).toLowerCase().includes(term.trim().toLowerCase()))
    : candidates;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">
        <UserPlus className="h-4 w-4" /> Ask suppliers
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Who should be asked?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            fd.set("partyIds", picked.join(","));
            const res = await askVendors(fd);
            setBusy(false);
            if (res?.ok) {
              setOpen(false);
              setPicked([]);
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-3 p-5"
        >
          <input type="hidden" name="rfqId" value={rfqId} />

          {candidates.length === 0 ? (
            <p className="text-sm text-muted">
              Every supplier on this company has already been asked.
            </p>
          ) : (
            <>
              <input
                className="input"
                placeholder="Search suppliers"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {shown.length === 0 && <p className="p-2 text-sm text-muted">Nothing matches.</p>}
                {shown.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-line"
                  >
                    <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span className="text-ink">{c.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted">{c.code}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">
                {picked.length === 0
                  ? "Nobody selected yet."
                  : `${picked.length} selected. They will appear on the comparison whether or not they reply.`}
              </p>
            </>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy || !picked.length} className="btn-primary disabled:opacity-50">
              {busy ? "Asking…" : "Ask them"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
