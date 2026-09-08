"use client";

import { useState } from "react";
import { Settings2, X } from "lucide-react";
import { updateReturn } from "@/app/(app)/finance/corporate-tax/actions";
import { SBR_REVENUE_CAP, LOSS_RELIEF_CAP } from "@/lib/corporatetax";
import { money } from "@/lib/money";

/**
 * The two decisions a return carries that the ledger cannot answer.
 *
 * Losses brought forward come from last year's return, and Small Business
 * Relief is an election somebody has to make — it is not automatic, and it is
 * claimed through the return itself. Both are shown with what they are worth,
 * so neither is a box that gets ticked without a reason.
 */
export default function TaxReturnSettings({
  id,
  lossesBroughtForward,
  sbrElected,
  notes,
  sbrEligible,
  sbrReason,
  taxWithoutSbr,
  disabled,
}: {
  id: string;
  lossesBroughtForward: number;
  sbrElected: boolean;
  notes: string | null;
  sbrEligible: boolean;
  sbrReason: string;
  taxWithoutSbr: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [elected, setElected] = useState(sbrElected);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost" disabled={disabled}>
        <Settings2 className="h-4 w-4" /> Losses &amp; relief
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Losses and relief</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await updateReturn(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="id" value={id} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Losses brought forward</label>
            <input
              name="lossesBroughtForward"
              type="number"
              step="0.01"
              min="0"
              defaultValue={lossesBroughtForward || ""}
              className="input"
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-muted">
              Losses from earlier years that have not been used yet. They carry forward for as long as it takes, but
              only {Math.round(LOSS_RELIEF_CAP * 100)}% of a year&rsquo;s taxable income can be wiped out with them
              &mdash; the rest waits for next year.
            </p>
          </div>

          <div className={`rounded-lg border p-3 ${sbrEligible ? "border-line" : "border-line bg-brand-paper"}`}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="sbrElected"
                checked={elected}
                onChange={(e) => setElected(e.target.checked)}
                disabled={!sbrEligible}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Claim Small Business Relief</span>
                <span className="block text-xs text-muted">{sbrReason}</span>
              </span>
            </label>
            {sbrEligible && (
              <p className="mt-2 text-xs text-muted">
                A business turning over AED {SBR_REVENUE_CAP.toLocaleString("en-AE")} or less can elect to be treated
                as having no taxable income. It is not automatic &mdash; the election is made on the return.
                {taxWithoutSbr > 0 && (
                  <>
                    {" "}Claiming it here saves <span className="font-medium text-ink">{money(taxWithoutSbr)}</span>.
                  </>
                )}
              </p>
            )}
            {!sbrEligible && elected && (
              <p className="mt-2 text-xs text-brand-gold">
                The election is recorded but will not be applied while the company does not qualify.
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              You cannot claim it if the company is a Qualifying Free Zone Person, or part of a multinational group
              turning over more than AED 3.15 billion. The system cannot check either of those &mdash; you have to know.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={notes ?? ""} placeholder="Anything the next reader should know" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
