"use client";

import { useState } from "react";
import { saveCalibration } from "@/app/(app)/inventory/actions";
import { CALIBRATION_RESULT_HELP, expiryFrom } from "@/lib/calibration";

/**
 * Recording a calibration (INV-12).
 *
 * The expiry is worked out from the calibration date rather than from today,
 * because a certificate for work done last week runs from when the work was
 * done. Counting from today would quietly extend every certificate by however
 * long the paperwork took to arrive.
 */
export default function CalibrationForm({
  equipmentId,
  label,
  months,
}: {
  equipmentId: string;
  label: string;
  months: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("Passed");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [span, setSpan] = useState(String(months || 12));

  const expires = result === "Passed" && on ? expiryFrom(on, Number(span) || 12) : null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        Calibrate
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-5">
        <h2 className="font-semibold text-heading">Record a calibration</h2>
        <p className="mt-1 text-sm text-ink">{label}</p>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await saveCalibration(fd);
            setBusy(false);
            if (res.ok) setOpen(false);
            else setError(res.error || "Could not record it");
          }}
          className="mt-4 space-y-3"
        >
          <input type="hidden" name="equipmentId" value={equipmentId} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Result</label>
            <select name="result" value={result} onChange={(e) => setResult(e.target.value)} className="input">
              <option value="Passed">Passed &mdash; in tolerance</option>
              <option value="Failed">Failed &mdash; out of tolerance</option>
            </select>
            <p className="mt-1 text-xs text-muted">{CALIBRATION_RESULT_HELP[result]}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Calibrated on</label>
              <input
                type="date" name="calibratedOn" value={on}
                onChange={(e) => setOn(e.target.value)} className="input" required
              />
            </div>
            {result === "Passed" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Valid for (months)</label>
                <input
                  type="number" min="1" max="120" name="months"
                  value={span} onChange={(e) => setSpan(e.target.value)} className="input"
                />
              </div>
            )}
          </div>

          {expires && (
            <p className="rounded bg-brand-paper p-2 text-xs text-muted">
              The certificate will run to{" "}
              <span className="font-medium text-ink">
                {expires.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
              , counted from the calibration date rather than from today.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Certificate number</label>
              <input name="certificateNo" className="input" placeholder="optional" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Who did it</label>
              <input name="calibratedBy" className="input" placeholder="The lab, or our own name" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" placeholder="Readings, adjustments, anything worth keeping" />
          </div>

          {result === "Failed" && (
            <p className="rounded bg-brand-gold/10 p-2 text-xs text-ink">
              Recording a failure blocks this equipment from use until it has been put right and calibrated again.
            </p>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Recording…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
