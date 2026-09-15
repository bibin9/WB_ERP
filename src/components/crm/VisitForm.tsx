"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { addVisit } from "@/app/(app)/crm/actions";

/**
 * Recording a site visit (CRM-12).
 *
 * The findings are optional here on purpose. Booking a visit for next Tuesday
 * is ordinary, and the enquiry should show that somebody is going without
 * claiming a report exists — that is the difference the status depends on, and
 * the note at the bottom says which of the two this will be before it saves.
 */
export default function VisitForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [findings, setFindings] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        <Plus className="h-3 w-3" /> Record
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Who went, and when?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await addVisit(fd);
            setBusy(false);
            if (res?.ok) {
              setOpen(false);
              setFindings("");
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-3 p-5"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date of the visit</label>
              <input
                type="date" name="visitedOn" className="input" required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Who is going</label>
              <input name="visitedBy" className="input" required placeholder="Name" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              What was found{" "}
              <span className="font-normal text-muted">(leave empty if the visit has not happened yet)</span>
            </label>
            <textarea
              name="findings" className="input" rows={4} value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder="Access, existing services, what the drawings do not show"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Where the report lives</label>
            <input name="reportRef" className="input" placeholder="Folder, drive link or file reference" />
          </div>

          <p
            className={`rounded p-2 text-xs ${
              findings.trim() ? "bg-brand-green/10 text-brand-green-700" : "bg-brand-gold/10 text-ink"
            }`}
          >
            {findings.trim()
              ? "This will show the enquiry as Site Report Submitted."
              : "With nothing written up, the enquiry will show the visit as booked and the report as still to come."}
          </p>

          {error && <p className="text-sm text-brand-gold">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Record it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
