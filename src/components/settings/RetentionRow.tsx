"use client";

import { useActionState, useState, useTransition } from "react";
import { Archive, Trash2 } from "lucide-react";
import { setRetention, runRetention } from "@/app/(app)/settings/retention/actions";
import { RETENTION_CHOICES } from "@/lib/auditmeta";
import { MAX_DAYS, retentionLabel, type Policy } from "@/lib/data-retention";

/**
 * One kind of record: what it is, how long it is kept, and what happens then.
 *
 * Everybody who may open the screen sees the periods; only an administrator
 * gets the controls, because knowing how far back the system goes is part of
 * using it, while changing it is not.
 */
export default function RetentionRow({
  policy,
  days,
  live,
  due,
  archived,
  cutoff,
  canEdit,
}: {
  policy: Policy;
  days: number;
  live: number;
  due: number;
  archived: number | null;
  cutoff: string;
  canEdit: boolean;
}) {
  const [error, save, saving] = useActionState(setRetention, undefined);
  const [message, setMessage] = useState<string | undefined>();
  const [running, startRun] = useTransition();
  const [custom, setCustom] = useState(!RETENTION_CHOICES.some((c) => c.days === days));
  const removes = policy.destination === "Removed";
  const Icon = removes ? Trash2 : Archive;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-heading">{policy.label}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted">{policy.what}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-paper px-3 py-1 text-xs font-medium text-heading">
          Kept {retentionLabel(days)}
        </span>
      </div>

      <p className="mt-3 max-w-2xl text-sm text-muted">
        <span className="font-medium text-ink">After that:</span> {policy.then}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="On the live table" value={live.toLocaleString()} />
        <Figure label={removes ? "Ready to remove" : "Ready to archive"} value={due.toLocaleString()} tone={due > 0 ? "warn" : undefined} />
        {archived !== null && <Figure label="Already in the archive" value={archived.toLocaleString()} />}
        <Figure label="Older than" value={cutoff} />
      </div>

      {canEdit ? (
        <>
          <form action={save} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="key" value={policy.key} />
            <label className="text-xs text-muted">
              <span className="mb-1 block">Keep for</span>
              {custom ? (
                <input
                  name="days"
                  type="number"
                  defaultValue={days}
                  min={policy.minDays}
                  max={MAX_DAYS}
                  className="input h-9 w-40 py-1 text-sm"
                  aria-label={`Days to keep ${policy.label}`}
                />
              ) : (
                <select name="days" defaultValue={days} className="input h-9 w-40 py-1 text-sm" aria-label={`How long to keep ${policy.label}`}>
                  {RETENTION_CHOICES.filter((c) => c.days >= policy.minDays).map((c) => (
                    <option key={c.days} value={c.days}>{c.label}</option>
                  ))}
                </select>
              )}
            </label>

            <button type="submit" disabled={saving} className="btn-primary h-9 px-4 text-sm disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>

            <button type="button" onClick={() => setCustom((v) => !v)} className="h-9 text-xs text-brand-blue-600 underline underline-offset-2">
              {custom ? "choose a standard period" : "enter a number of days"}
            </button>

            <span className="grow" />

            <button
              type="button"
              disabled={running || due === 0}
              onClick={() =>
                startRun(async () => {
                  const fd = new FormData();
                  fd.set("key", policy.key);
                  setMessage(await runRetention(undefined, fd));
                })
              }
              className="flex h-9 items-center gap-2 rounded-lg border border-line px-4 text-sm text-ink enabled:hover:bg-line disabled:opacity-40"
            >
              <Icon className="h-4 w-4" />
              {running
                ? removes ? "Removing…" : "Moving…"
                : due === 0
                  ? "Nothing due"
                  : `${removes ? "Remove" : "Archive"} ${due.toLocaleString()} now`}
            </button>
          </form>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
        </>
      ) : (
        <p className="mt-4 text-xs text-muted">Only an administrator can change this.</p>
      )}

      <p className="mt-3 text-xs text-muted">
        The minimum is {policy.minDays.toLocaleString()} days. {policy.floorReason} This runs by itself each time the
        system is updated; the button only does it sooner.
      </p>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg bg-brand-paper p-3">
      <div className={`text-lg font-bold tabular-nums ${tone === "warn" ? "text-brand-gold" : "text-ink"}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
