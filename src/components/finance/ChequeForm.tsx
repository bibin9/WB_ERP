"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { recordCheque, updateCheque } from "@/app/(app)/finance/cheques/actions";
import { DIRECTIONS } from "@/lib/cheques";

export type EditingCheque = {
  id: string;
  direction: string;
  chequeNo: string;
  bankName: string | null;
  chequeDate: string;
  amount: number;
  partyId: string | null;
  heldBy: string | null;
  notes: string | null;
};

export default function ChequeForm({
  companyId,
  parties,
  cheque,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string; type: string }[];
  cheque?: EditingCheque;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState(cheque?.direction ?? "Received");
  const editing = !!cheque;

  const received = direction === "Received";
  // A received cheque comes from a customer; an issued one goes to a supplier.
  const relevant = parties.filter((p) =>
    received ? p.type !== "Supplier" : p.type !== "Customer"
  );

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
      <Plus className="h-4 w-4" /> Record a cheque
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `Cheque ${cheque!.chequeNo}` : "Record a cheque"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateCheque(fd) : await recordCheque(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? (
            <input type="hidden" name="id" value={cheque!.id} />
          ) : (
            <input type="hidden" name="companyId" value={companyId} />
          )}

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Recording a cheque does not touch your accounts. It goes into the register so you can see what is due to
            be banked and when. The accounts are only updated on the day you mark it cleared.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Received or issued</label>
              <select
                name="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="input"
              >
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === "Received" ? "Received from a customer" : "Issued to a supplier"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Amount</label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                defaultValue={cheque?.amount || ""}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Cheque number</label>
              <input name="chequeNo" className="input" defaultValue={cheque?.chequeNo ?? ""} placeholder="000123" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date on the cheque</label>
              <input name="chequeDate" type="date" className="input" defaultValue={cheque?.chequeDate ?? ""} required />
              <p className="mt-1 text-xs text-muted">The day it can be banked, not today.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Bank</label>
              <input name="bankName" className="input" defaultValue={cheque?.bankName ?? ""} placeholder="Emirates NBD" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                {received ? "From" : "To"}
              </label>
              <select name="partyId" className="input" defaultValue={cheque?.partyId ?? ""}>
                <option value="">&mdash; not linked &mdash;</option>
                {relevant.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Who is holding it</label>
              <input name="heldBy" className="input" defaultValue={cheque?.heldBy ?? ""} placeholder="Accounts safe" />
              <p className="mt-1 text-xs text-muted">A cheque is a bearer instrument &mdash; whoever has the paper can bank it.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
              <input name="notes" className="input" defaultValue={cheque?.notes ?? ""} placeholder="Optional" />
            </div>
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
