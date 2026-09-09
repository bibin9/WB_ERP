"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { recordAdvance, updateAdvance } from "@/app/(app)/finance/advances/actions";
import { DIRECTIONS, DIRECTION_HELP, recoveryOn } from "@/lib/advances";
import { money } from "@/lib/money";

export type EditingAdvance = {
  id: string;
  direction: string;
  reference: string;
  jobId: string | null;
  recoveryPercent: number | null;
  notes: string | null;
};

/**
 * Recording an advance.
 *
 * Unlike retention, this posts. The money has already moved, and if this form
 * does not put it in the ledger then nothing will, so the wording says plainly
 * what will land in the accounts before anybody presses save.
 *
 * Editing is deliberately narrower than creating: only the job, the recovery
 * rate and the note can change afterwards. The amount and the date are on a
 * posted voucher, and quietly changing those is how a register stops agreeing
 * with the accounts it is supposed to prove.
 */
export default function AdvanceForm({
  companyId,
  parties,
  jobs,
  bankAccounts,
  row,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string; type: string }[];
  jobs: { id: string; code: string; name: string }[];
  bankAccounts: { id: string; code: string; name: string }[];
  row?: EditingAdvance;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState(row?.direction ?? "Received");
  const [contractValue, setContractValue] = useState("");
  const [percent, setPercent] = useState(row?.recoveryPercent ? String(row.recoveryPercent) : "");
  const [amount, setAmount] = useState("");

  const editing = !!row;
  const received = direction === "Received";
  // A customer pays us an advance; a supplier receives one. Offering the whole
  // list on both sides is how an advance ends up on the wrong ledger.
  const relevant = parties.filter((p) => (received ? p.type !== "Supplier" : p.type !== "Customer"));

  // The advance is usually a percentage of the contract, and that is how it is
  // written in the letter. Working it out here saves reaching for a calculator
  // and keying the answer in wrongly.
  const suggested = recoveryOn(Number(contractValue) || 0, Number(percent) || 0);

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
      <Plus className="h-4 w-4" /> Record advance
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">
            {editing ? `Advance on ${row!.reference}` : "Record an advance"}
          </h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateAdvance(fd) : await recordAdvance(fd);
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

          {editing ? (
            <p className="rounded bg-brand-paper p-3 text-xs text-muted">
              The amount and the date are on a posted voucher, so they cannot be changed here. If either is wrong,
              reverse that voucher in the Day Book and record the advance again.
            </p>
          ) : (
            <p className="rounded bg-brand-paper p-3 text-xs text-muted">
              This posts. The money has moved, so saving this puts it in your accounts:{" "}
              {received
                ? "into the bank, and into what you owe the customer until the work is billed."
                : "out of the bank, and into what the supplier owes you until they bill for it."}{" "}
              It is not income or a cost &mdash; nothing has been supplied yet.
            </p>
          )}

          {!editing && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Which way</label>
                  <select
                    name="direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    className="input"
                  >
                    {DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === "Received" ? "A customer paid us up front" : "We paid a supplier up front"}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">{DIRECTION_HELP[direction]}</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Reference</label>
                  <input
                    name="reference"
                    className="input"
                    placeholder="Their receipt no, or the contract clause"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">
                    {received ? "Customer" : "Supplier"}
                  </label>
                  <select name="partyId" className="input" required>
                    <option value="">Choose&hellip;</option>
                    {relevant.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Date the money moved</label>
                  <input
                    type="date"
                    name="date"
                    className="input"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink">
                  {received ? "Received into" : "Paid from"}
                </label>
                <select name="bankAccountId" className="input" required>
                  <option value="">Choose the bank or cash account&hellip;</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-line p-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Contract value</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={contractValue}
                      onChange={(e) => setContractValue(e.target.value)}
                      className="input h-9 py-1.5 text-sm"
                      placeholder="optional"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Advance %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      name="recoveryPercent"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      className="input h-9 py-1.5 text-sm"
                      placeholder="10"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="input h-9 py-1.5 text-sm"
                      required
                    />
                  </div>
                </div>
                {suggested > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(suggested))}
                    className="mt-2 text-xs text-brand-blue-600 hover:underline"
                  >
                    Use {money(suggested)} &mdash; {percent}% of the contract value
                  </button>
                )}
                <p className="mt-2 text-xs text-muted">
                  The percentage is also what each certificate normally recovers, so it is offered again when you
                  come to set the advance against an invoice.
                </p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Job</label>
            <select name="jobId" className="input" defaultValue={row?.jobId ?? ""}>
              <option value="">Not against a particular job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input
              name="notes"
              className="input"
              defaultValue={row?.notes ?? ""}
              placeholder="Bank guarantee reference, or what it was for"
            />
          </div>

          {!editing && (
            <p className="rounded bg-brand-gold/10 p-3 text-xs text-ink">
              <span className="font-semibold">If this advance is for taxable work,</span> UAE rules make the day you
              received the money a tax point, so a tax invoice is due on it. Raise that on the Invoices screen and
              then recover this advance against it. VAT is not charged here, so it can never be declared twice.
            </p>
          )}

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving…" : editing ? "Save" : "Record and post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
