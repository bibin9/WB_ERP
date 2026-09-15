"use client";

import { useState } from "react";
import { Award, X } from "lucide-react";
import { awardEnquiry } from "@/app/(app)/inventory/actions";

type Ranked = {
  partyId: string;
  partyName: string;
  total: number;
  rank: number | null;
  isLowest: boolean;
  extraOverLowest: number;
  extraFraction: number;
  leadTimeDays: number | null;
  late: boolean;
  expired: boolean;
  received: boolean;
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Choosing a supplier (INV-06).
 *
 * The reason box appears the moment a supplier other than the cheapest is
 * selected, and says what it will cost. Asking for it afterwards, or leaving it
 * optional, produces the reason people write when they want the dialog to go
 * away — and that is the sentence an auditor reads a year later.
 */
export default function AwardForm({
  rfqId,
  ranked,
  stores,
  enoughInvited,
  minVendors,
}: {
  rfqId: string;
  ranked: Ranked[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  enoughInvited: boolean;
  minVendors: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const priced = ranked.filter((r) => r.received);
  const [partyId, setPartyId] = useState(priced[0]?.partyId ?? "");

  const chosen = priced.find((r) => r.partyId === partyId);
  const lowest = priced.find((r) => r.isLowest);
  const needsReason = !!chosen && !chosen.isLowest;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Award className="h-4 w-4" /> Award
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Who has won it?</h2>
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
            const res = await awardEnquiry(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not award");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="rfqId" value={rfqId} />

          {!enoughInvited && (
            <p className="rounded bg-brand-gold/10 p-3 text-sm text-ink">
              <span className="font-semibold">Not enough suppliers asked.</span> At least {minVendors} have to be
              asked before this can be awarded — with fewer there is nothing to compare the price against, so it
              cannot be called competitive.
            </p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Supplier</label>
            <select
              name="partyId" className="input" value={partyId}
              onChange={(e) => setPartyId(e.target.value)} required
            >
              {priced.map((r) => (
                <option key={r.partyId} value={r.partyId}>
                  {r.partyName} — {money(r.total)}
                  {r.isLowest ? " (lowest)" : ` (+${money(r.extraOverLowest)})`}
                </option>
              ))}
            </select>
          </div>

          {chosen && (
            <div className="rounded bg-brand-paper p-3 text-xs text-muted">
              {chosen.isLowest ? (
                <>This is the lowest quote, so no reason is needed.</>
              ) : (
                <>
                  <span className="font-medium text-ink">
                    {money(chosen.extraOverLowest)} dearer than {lowest?.partyName}
                  </span>
                  {chosen.extraFraction > 0 && <> — {(chosen.extraFraction * 100).toFixed(1)}% more.</>}
                </>
              )}
              {chosen.leadTimeDays != null && (
                <div className="mt-1">
                  Lead time {chosen.leadTimeDays} days{chosen.late && ", which is after site needs it"}.
                </div>
              )}
              {chosen.expired && <div className="mt-1 text-brand-gold">This quote has expired and would need confirming.</div>}
            </div>
          )}

          {needsReason && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Why this supplier rather than the lowest?
              </label>
              <textarea
                name="reason" className="input" rows={3} required
                placeholder="Lead time, past performance, a technical difference — whatever it actually was"
              />
              <p className="mt-1 text-xs text-muted">
                A year from now this note is the only record of the decision.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Deliver to</label>
              <select name="storeId" className="input" defaultValue={stores.find((s) => s.isDefault)?.id ?? ""}>
                <option value="">Not decided</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Order date</label>
              <input
                type="date" name="date" className="input"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            This raises a <span className="font-medium text-ink">draft</span> purchase order at the prices they
            quoted. Winning an enquiry is not an approval — the purchase order route still decides who has to sign
            before anything can be received against it.
          </p>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy || !partyId} className="btn-primary disabled:opacity-50">
              {busy ? "Awarding…" : "Award and raise the order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
