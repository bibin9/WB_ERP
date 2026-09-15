"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { addInteraction } from "@/app/(app)/crm/actions";

const KINDS = ["Call", "Email", "Meeting", "Site visit", "Quotation sent", "Note"];

/** Adding to the history (CRM-01). Append-only: nothing here edits what is there. */
export default function InteractionForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What happened?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await addInteraction(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-3 p-5"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">What kind</label>
              <select name="kind" className="input" defaultValue="Call">
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">When</label>
              <input
                type="date" name="at" className="input"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What was said</label>
            <textarea
              name="summary" className="input" rows={3} required
              placeholder="Enough that somebody picking this up next month knows where it stands"
            />
          </div>
          {error && <p className="text-sm text-brand-gold">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Add it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
