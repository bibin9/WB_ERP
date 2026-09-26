"use client";

import { useState, useTransition } from "react";
import { BookmarkPlus } from "lucide-react";
import { saveOrderAsTemplate } from "@/app/(app)/inventory/actions";

/**
 * Keeping an order to raise again.
 *
 * Asks for a name rather than generating one, because the name is the whole
 * value: the person picking it next month reads "Monthly PRO package", not
 * "Template 3".
 */
export default function SaveAsTemplate({ orderId, suggestion }: { orderId: string; suggestion: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestion);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();

  if (saved) return <span className="self-center text-xs text-brand-green-700">Saved as a template.</span>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        <BookmarkPlus className="h-4 w-4" /> Save as template
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Monthly PRO package"
        className="input h-9 w-56 py-1 text-sm"
        aria-label="Template name"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setError("");
            const res = await saveOrderAsTemplate(orderId, name);
            if (res.ok) setSaved(true);
            else setError(res.error ?? "Could not save it.");
          })
        }
        className="btn-primary h-9 px-4 text-sm disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Cancel</button>
      {error && <span className="text-xs text-brand-gold">{error}</span>}
    </div>
  );
}
