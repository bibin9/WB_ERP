"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { fileReport } from "@/app/(app)/crm/actions";

/** Writing up a visit that has already happened (CRM-12). */
export default function ReportForm({ visitId, visitedOn }: { visitId: string; visitedOn: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand-blue-600 hover:underline">
        File the report
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="font-semibold text-heading">What was found?</h2>
            <p className="text-xs text-muted">Visit on {visitedOn}</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await fileReport(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-3 p-5"
        >
          <input type="hidden" name="visitId" value={visitId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">The report</label>
            <textarea
              name="findings" className="input" rows={6} required
              placeholder="Access, existing services, what the drawings do not show"
            />
            <p className="mt-1 text-xs text-muted">
              This is what the estimate gets built on, and filing it marks the enquiry as reported.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Where the signed report lives</label>
            <input name="reportRef" className="input" placeholder="optional" />
          </div>
          {error && <p className="text-sm text-brand-gold">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Filing…" : "File it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
