"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveMovement } from "@/app/(app)/inventory/actions";
import { MOVEMENT_HELP } from "@/lib/stock";
import { money } from "@/lib/money";

/**
 * Recording what moved.
 *
 * The form asks for a kind first and then shows only what that kind needs. A
 * receipt needs a price and a supplier; an issue needs a job and is priced from
 * the shelf; a transfer needs a second store and no price at all. Showing all
 * of it at once and greying out the irrelevant half is how a storekeeper ends
 * up typing a cost into an issue and wondering why it was ignored.
 */

/** What the person doing this actually calls it, in the order they need it. */
const KINDS = [
  { value: "Receipt", label: "Material arrived" },
  { value: "Issue", label: "Material out to a job" },
  { value: "Return to store", label: "Material came back from a job" },
  { value: "Transfer", label: "Moved between our stores" },
  { value: "Return to supplier", label: "Sent back to the supplier" },
  { value: "Adjustment in", label: "Found in a count" },
  { value: "Adjustment out", label: "Missing, damaged or short" },
];

const NEEDS_PRICE = new Set(["Receipt", "Return to store", "Adjustment in"]);
const NEEDS_JOB = new Set(["Issue", "Return to store"]);
const NEEDS_SUPPLIER = new Set(["Receipt", "Return to supplier"]);

export default function MovementForm({
  companyId,
  items,
  stores,
  jobs,
  parties,
  balances,
}: {
  companyId: string;
  items: { id: string; code: string; name: string; unitCode: string }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  jobs: { id: string; code: string; name: string }[];
  parties: { id: string; code: string; name: string }[];
  /** What is on hand, keyed "itemId:storeId", so the form can price and warn. */
  balances: Record<string, { quantity: number; value: number; averageCost: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("Receipt");
  const [itemId, setItemId] = useState("");
  const [storeId, setStoreId] = useState(stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");

  const item = items.find((i) => i.id === itemId);
  const onHand = balances[`${itemId}:${storeId}`] ?? { quantity: 0, value: 0, averageCost: 0 };
  const pricedFromShelf = !NEEDS_PRICE.has(kind) && kind !== "Transfer" ? true : kind === "Transfer";
  const qty = Number(quantity) || 0;
  const tooMuch = pricedFromShelf && qty > onHand.quantity;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Record a movement
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Record a stock movement</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = await saveMovement(fd);
            setSaving(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What happened</label>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              {kind === "Transfer"
                ? "Moving stock between our own stores. Nothing is posted to the accounts, because what the company owns has not changed."
                : MOVEMENT_HELP[kind]}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Item</label>
              <select name="itemId" value={itemId} onChange={(e) => setItemId(e.target.value)} className="input" required>
                <option value="">Choose&hellip;</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                {kind === "Transfer" ? "From store" : "Store"}
              </label>
              <select name="storeId" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input" required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {itemId && (
            <p className="rounded bg-brand-paper p-2 text-xs text-muted">
              On this shelf now: <span className="font-medium text-ink">{onHand.quantity.toLocaleString()}</span>
              {item ? ` ${item.unitCode}` : ""}
              {onHand.quantity > 0 && <> at an average of {money(onHand.averageCost)}, worth {money(onHand.value)}</>}
            </p>
          )}

          {kind === "Transfer" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">To store</label>
              <select name="toStoreId" className="input" required>
                <option value="">Choose&hellip;</option>
                {stores.filter((s) => s.id !== storeId).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">How much</label>
              <input
                type="number" step="0.001" min="0" name="quantity"
                value={quantity} onChange={(e) => setQuantity(e.target.value)}
                className="input" required
              />
              {tooMuch && (
                <p className="mt-1 text-xs text-brand-gold">
                  Only {onHand.quantity.toLocaleString()} is on this shelf.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date</label>
              <input type="date" name="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
          </div>

          {NEEDS_PRICE.has(kind) ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Cost of one {item?.unitCode ?? "unit"}</label>
              <input type="number" step="0.01" min="0" name="unitCost" className="input" required />
              <p className="mt-1 text-xs text-muted">
                What was actually paid. It moves the average of everything already on the shelf.
              </p>
            </div>
          ) : (
            kind !== "Transfer" && (
              <p className="rounded bg-brand-paper p-2 text-xs text-muted">
                Priced at the average on the shelf at the moment it moves, so there is nothing to type.
              </p>
            )
          )}

          {NEEDS_JOB.has(kind) && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Job</label>
              <select name="jobId" className="input" required>
                <option value="">Choose&hellip;</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                {kind === "Issue"
                  ? "This is what puts the material cost on that contract."
                  : "The job that had it is credited with what it cost."}
              </p>
            </div>
          )}

          {NEEDS_SUPPLIER.has(kind) && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Supplier</label>
              <select name="partyId" className="input">
                <option value="">Not recorded</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Reference</label>
              <input name="reference" className="input" placeholder="Delivery note, issue note, count sheet" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
              <input name="notes" className="input" placeholder="optional" />
            </div>
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
