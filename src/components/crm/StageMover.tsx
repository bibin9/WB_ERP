"use client";

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { changeStage } from "@/app/(app)/crm/actions";
import { LEAD_STAGES, STAGE_HELP, stageProbability } from "@/lib/leads";

/**
 * Moving an enquiry along (CRM-02).
 *
 * The probability of the stage being moved to is shown while choosing, because
 * that is the consequence — moving a card changes the forecast, and somebody
 * should see by how much before they do it rather than discover it on a report.
 */
export default function StageMover({ leadId, stage }: { leadId: string; stage: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [to, setTo] = useState("");

  const losing = to === "Lost";
  const here = Math.round(stageProbability(stage) * 100);
  const there = to ? Math.round(stageProbability(to) * 100) : null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <ArrowRight className="h-4 w-4" /> Move it on
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Where has it got to?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setError("");
            setBusy(true);
            const res = await changeStage(fd);
            setBusy(false);
            if (res?.ok) { setOpen(false); setTo(""); }
            else setError(res?.error || "Could not move it");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="leadId" value={leadId} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Move to</label>
            <select name="to" value={to} onChange={(e) => setTo(e.target.value)} className="input" required>
              <option value="">Choose&hellip;</option>
              {LEAD_STAGES.filter((s) => s !== stage).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {to && <p className="mt-1 text-xs text-muted">{STAGE_HELP[to]}</p>}
          </div>

          {there !== null && (
            <div className="flex items-center justify-center gap-3 rounded bg-brand-paper p-3 text-sm">
              <span className="tabular-nums text-muted">{here}%</span>
              <ArrowRight className="h-4 w-4 text-muted" />
              <span className="font-semibold tabular-nums text-heading">{there}%</span>
              <span className="text-xs text-muted">chance of winning, in the forecast</span>
            </div>
          )}

          {losing && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Why was it lost?</label>
                <textarea name="lostReason" className="input" rows={3} required
                  placeholder="Beaten on price, programme too tight, nobody chased it — whatever it actually was" />
                <p className="mt-1 text-xs text-muted">
                  Six months from now the file will say Lost, and this is the only thing that will explain it.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Who won it</label>
                <input name="lostTo" className="input" placeholder="If you know" />
              </div>
            </>
          )}

          {!losing && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Note</label>
              <input name="note" className="input" placeholder="Anything worth putting in the history" />
            </div>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy || !to} className="btn-primary disabled:opacity-50">
              {busy ? "Moving…" : "Move it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
