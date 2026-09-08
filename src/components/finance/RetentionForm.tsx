"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { recordRetention, updateRetention } from "@/app/(app)/finance/retention/actions";
import { DIRECTIONS, STAGES, STAGE_HELP, retentionOn } from "@/lib/retention";
import { money } from "@/lib/money";

export type EditingRetention = {
  id: string;
  direction: string;
  reference: string;
  jobId: string | null;
  partyId: string | null;
  amount: number;
  percent: number | null;
  dueDate: string;
  stage: string;
  notes: string | null;
};

export default function RetentionForm({
  companyId,
  parties,
  jobs,
  row,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string; type: string }[];
  jobs: { id: string; code: string; name: string }[];
  row?: EditingRetention;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState(row?.direction ?? "Receivable");
  const [stage, setStage] = useState(row?.stage ?? "Defects liability");
  const [certValue, setCertValue] = useState("");
  const [percent, setPercent] = useState(row?.percent ? String(row.percent) : "10");
  const [amount, setAmount] = useState(row?.amount ? String(row.amount) : "");

  const editing = !!row;
  const receivable = direction === "Receivable";
  const relevant = parties.filter((p) => (receivable ? p.type !== "Supplier" : p.type !== "Customer"));

  // A certificate value and a percentage is how the figure is arrived at on
  // paper, so the form works it out rather than making somebody reach for a
  // calculator and key the answer in.
  const suggested = retentionOn(Number(certValue) || 0, Number(percent) || 0);

  const trigger = editing ? (
    <button
      onClick={() => setOpen(true)}
      title="Edit"
      className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="btn-primary">
      <Plus className="h-4 w-4" /> Record retention
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `Retention on ${row!.reference}` : "Record retention"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateRetention(fd) : await recordRetention(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={row!.id} />
          ) : (
            <input type="hidden" name="companyId" value={companyId} />
          )}

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            This does not change your accounts. The certificate that withheld the money already did that. What goes
            here is the record of whose money it is and when you can ask for it &mdash; and your accounts only change
            again on the day you release it.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Which way</label>
              <select name="direction" value={direction} onChange={(e) => setDirection(e.target.value)} className="input">
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === "Receivable" ? "A client is holding it from us" : "We are holding it from a subcontractor"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Certificate or invoice</label>
              <input name="reference" className="input" defaultValue={row?.reference ?? ""} placeholder="IPC-04" required />
            </div>
          </div>

          <div className="rounded-lg border border-line p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Certified value</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={certValue}
                  onChange={(e) => setCertValue(e.target.value)}
                  className="input h-9 py-1.5 text-sm"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Rate %</label>
                <input
                  name="percent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  className="input h-9 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Amount held</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input h-9 py-1.5 text-sm"
                  required
                />
              </div>
            </div>
            {suggested > 0 && (
              <p className="mt-2 text-xs text-muted">
                {percent}% of {money(Number(certValue))} is <span className="font-medium text-ink">{money(suggested)}</span>.{" "}
                <button
                  type="button"
                  onClick={() => setAmount(String(suggested))}
                  className="text-brand-blue-600 underline"
                >
                  Use that
                </button>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">{receivable ? "Client" : "Subcontractor"}</label>
              <select name="partyId" className="input" defaultValue={row?.partyId ?? ""}>
                <option value="">&mdash; not linked &mdash;</option>
                {relevant.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Job</label>
              <select name="jobId" className="input" defaultValue={row?.jobId ?? ""}>
                <option value="">&mdash; not linked &mdash;</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} · {j.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Which half</label>
              <select name="stage" value={stage} onChange={(e) => setStage(e.target.value)} className="input">
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">{STAGE_HELP[stage]}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Releasable on</label>
              <input name="dueDate" type="date" className="input" defaultValue={row?.dueDate ?? ""} required />
              <p className="mt-1 text-xs text-muted">
                For the defects half, this is usually a year after handover.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={row?.notes ?? ""} placeholder="Optional" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editing ? "Save" : "Add to register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
