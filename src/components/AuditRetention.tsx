"use client";

import { useActionState, useState, useTransition } from "react";
import { Archive, Clock } from "lucide-react";
import { setAuditRetention, runAuditArchive } from "@/app/(app)/audit/actions";
import { RETENTION_CHOICES, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, retentionLabel } from "@/lib/auditmeta";

/**
 * The housekeeping panel under the audit trail.
 *
 * Shown only to an administrator. Everyone else sees the sentence above it
 * saying what the current window is, because knowing how far back the screen
 * goes is part of reading it, and being unable to change it is not a reason to
 * be unable to see it.
 */
export default function AuditRetention({
  days,
  dueCount,
  archivedCount,
}: {
  days: number;
  dueCount: number;
  archivedCount: number;
}) {
  const [error, save, saving] = useActionState(setAuditRetention, undefined);
  const [message, setMessage] = useState<string | undefined>();
  const [archiving, startArchive] = useTransition();
  const [custom, setCustom] = useState(!RETENTION_CHOICES.some((c) => c.days === days));

  return (
    <div className="card mt-5 p-5">
      <div className="mb-3 flex items-center gap-2 text-heading">
        <Clock className="h-5 w-5" />
        <h2 className="font-semibold">How long entries stay on this screen</h2>
      </div>

      <p className="mb-4 text-sm text-muted">
        Entries older than <span className="font-medium text-ink">{retentionLabel(days)}</span> move to the
        archive. Nothing is deleted — the archive is on the tab above, and it is never emptied. Moving
        them keeps this screen quick as the trail grows.
      </p>

      <form action={save} className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          <span className="mb-1 block">Keep on this screen</span>
          {custom ? (
            <input
              name="days"
              type="number"
              defaultValue={days}
              min={MIN_RETENTION_DAYS}
              max={MAX_RETENTION_DAYS}
              className="input h-9 w-40 py-1 text-sm"
              aria-label="Days to keep"
            />
          ) : (
            <select name="days" defaultValue={days} className="input h-9 w-40 py-1 text-sm">
              {RETENTION_CHOICES.map((c) => (
                <option key={c.days} value={c.days}>{c.label}</option>
              ))}
            </select>
          )}
        </label>

        <button type="submit" disabled={saving} className="btn-primary h-9 px-4 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>

        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className="h-9 text-xs text-brand-blue-600 underline underline-offset-2"
        >
          {custom ? "choose a standard period" : "enter a number of days"}
        </button>

        <span className="grow" />

        <button
          type="button"
          disabled={archiving || dueCount === 0}
          onClick={() =>
            startArchive(async () => {
              setMessage(await runAuditArchive());
            })
          }
          className="flex h-9 items-center gap-2 rounded-lg border border-line px-4 text-sm text-ink enabled:hover:bg-line disabled:opacity-40"
        >
          <Archive className="h-4 w-4" />
          {archiving
            ? "Moving…"
            : dueCount === 0
              ? "Nothing to archive"
              : `Archive ${dueCount.toLocaleString()} now`}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 text-sm text-brand-green-700">{message}</p>}

      <p className="mt-4 text-xs text-muted">
        {archivedCount.toLocaleString()} entr{archivedCount === 1 ? "y is" : "ies are"} in the archive.
        Archiving also runs by itself each time the system is updated, so this button is only for doing
        it sooner.
      </p>
    </div>
  );
}
