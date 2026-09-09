"use client";

import { useState } from "react";
import { recoverAdvance, closeAdvance } from "@/app/(app)/finance/advances/actions";
import { recoveryOn } from "@/lib/advances";
import { money } from "@/lib/money";

/**
 * Setting an advance against an invoice, or ending it another way.
 *
 * Recovery is the half that goes wrong, so it is its own dialog rather than an
 * inline field. Two things have to be visible at the moment somebody types a
 * figure: how much is left, and that this moves no money. An advance recovery
 * reduces what the other party owes because they have already paid it — the
 * bank is untouched, and people expect otherwise.
 */
export default function RecoverAdvance({
  id,
  reference,
  direction,
  outstanding,
  recoveryPercent,
  invoices,
  writeOffAccounts,
  bankAccounts,
}: {
  id: string;
  reference: string;
  direction: string;
  outstanding: number;
  recoveryPercent: number | null;
  invoices: { id: string; number: string; grossTotal: number }[];
  writeOffAccounts: { id: string; code: string; name: string }[];
  bankAccounts: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"recover" | "close">("recover");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [certValue, setCertValue] = useState("");
  const [status, setStatus] = useState("Refunded");

  const received = direction === "Received";
  const suggested = recoveryPercent ? recoveryOn(Number(certValue) || 0, recoveryPercent) : 0;
  const over = Number(amount) > outstanding;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-line"
        title="Set this advance against an invoice"
      >
        Recover
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
      <div className="card w-full max-w-md p-5">
        <h2 className="font-semibold text-heading">Advance on {reference}</h2>
        <p className="mt-1 text-sm text-ink">
          <span className="font-semibold tabular-nums">{money(outstanding)}</span> still to recover
        </p>

        <div className="mt-4 flex gap-1 rounded-lg bg-brand-paper p-1 text-sm">
          <button
            onClick={() => setMode("recover")}
            className={`flex-1 rounded px-3 py-1.5 ${mode === "recover" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted"}`}
          >
            Recover against an invoice
          </button>
          <button
            onClick={() => setMode("close")}
            className={`flex-1 rounded px-3 py-1.5 ${mode === "close" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted"}`}
          >
            Refund or write off
          </button>
        </div>

        {mode === "recover" ? (
          <form
            action={async (fd) => {
              setError("");
              setBusy(true);
              const res = await recoverAdvance(fd);
              setBusy(false);
              if (res.ok) setOpen(false);
              else setError(res.error || "Could not recover");
            }}
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="id" value={id} />

            <p className="rounded bg-brand-paper p-3 text-xs text-muted">
              {received ? (
                <>
                  This moves no money. It reduces what the customer owes you, because they have already paid this
                  much. Their invoice is settled in part by their own advance.
                </>
              ) : (
                <>
                  This moves no money. It reduces what you owe the supplier, because they are already holding this
                  much of yours.
                </>
              )}
            </p>

            {recoveryPercent && (
              <div className="rounded-lg border border-line p-3">
                <label className="mb-1 block text-xs font-medium text-muted">
                  Certificate value (recovers {recoveryPercent}%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={certValue}
                  onChange={(e) => setCertValue(e.target.value)}
                  className="input h-9 py-1.5 text-sm"
                  placeholder="optional"
                />
                {suggested > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(Math.min(suggested, outstanding)))}
                    className="mt-2 text-xs text-brand-blue-600 hover:underline"
                  >
                    Use {money(Math.min(suggested, outstanding))}
                    {suggested > outstanding && " — capped at what is left"}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Amount recovered</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Date</label>
                <input
                  type="date"
                  name="date"
                  className="input"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                />
              </div>
            </div>

            {over && (
              <p className="rounded bg-brand-gold/10 p-2 text-xs text-ink">
                That is more than the {money(outstanding)} left on this advance. Recovering more than was advanced
                would turn what you owe into an apparent asset.
              </p>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Against which invoice</label>
              <select name="invoiceId" className="input">
                <option value="">Not against a particular invoice</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {money(i.grossTotal)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                Naming it is how the set-off can be explained a year later.
              </p>
            </div>

            {error && <p className="text-sm text-brand-gold">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancel
              </button>
              <button disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? "Recovering…" : "Recover"}
              </button>
            </div>
          </form>
        ) : (
          <form
            action={async (fd) => {
              setError("");
              setBusy(true);
              const res = await closeAdvance(fd);
              setBusy(false);
              if (res.ok) setOpen(false);
              else setError(res.error || "Could not close");
            }}
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="id" value={id} />

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">What is happening</label>
              <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                <option value="Refunded">Refunded — the money is going back</option>
                <option value="Written off">Written off — it is not coming back</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {status === "Refunded"
                  ? `This moves real money. The remaining ${money(outstanding)} ${received ? "leaves your bank" : "comes back into your bank"}.`
                  : "This moves no money. The balance is taken to the profit and loss, which is a decision rather than a correction."}
              </p>
            </div>

            {status === "Refunded" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">
                  {received ? "Paid from" : "Received into"}
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
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Take the write-off to</label>
                <select name="writeOffAccountId" className="input" required>
                  <option value="">Choose an account&hellip;</option>
                  {writeOffAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date</label>
              <input
                type="date"
                name="date"
                className="input"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </div>

            {error && <p className="text-sm text-brand-gold">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancel
              </button>
              <button disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? "Saving…" : status === "Refunded" ? "Refund" : "Write off"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
