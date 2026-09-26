"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveMovement } from "@/app/(app)/inventory/actions";
import ItemForm, { type CreatedItem } from "./ItemForm";
import StoreForm, { type CreatedStore } from "./StoreForm";
import PartyForm, { type CreatedParty } from "@/components/finance/PartyForm";
import { MOVEMENT_HELP, isInward } from "@/lib/stock";
import { binLabel, binMismatch } from "@/lib/bins";
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
  bins = {},
  binHoldings = {},
  itemCategories = [],
  canAddItem = false,
  canAddParty = false,
  canAddStore = false,
}: {
  companyId: string;
  items: { id: string; code: string; name: string; unitCode: string; category?: string | null }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  jobs: { id: string; code: string; name: string }[];
  parties: { id: string; code: string; name: string }[];
  /** What is on hand, keyed "itemId:storeId", so the form can price and warn. */
  balances: Record<string, { quantity: number; value: number; averageCost: number }>;
  /** The bins in each store, keyed by store id. Absent means the store has none. */
  bins?: Record<string, { id: string; code: string; zone: string | null; materialType: string | null }[]>;
  /** What each bin holds of each item, keyed "itemId:binId". */
  binHoldings?: Record<string, number>;
  /** The categories already in use, for the item dialog this form can open. */
  itemCategories?: string[];
  /** Each master is somebody's to keep: only offered to whoever keeps it. */
  canAddItem?: boolean;
  canAddParty?: boolean;
  canAddStore?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("Receipt");
  // A delivery turns up with something not in the catalogue, from a supplier
  // nobody has set up. The dialogs live outside this form — a form element
  // cannot be nested — so what is open is held here.
  const [adding, setAdding] = useState<"item" | "store" | "party" | null>(null);
  const [extraItems, setExtraItems] = useState<{ id: string; code: string; name: string; unitCode: string; category?: string | null }[]>([]);
  const [extraStores, setExtraStores] = useState<{ id: string; code: string; name: string; isDefault: boolean }[]>([]);
  const [extraParties, setExtraParties] = useState<{ id: string; code: string; name: string }[]>([]);
  const [itemId, setItemId] = useState("");
  const [storeId, setStoreId] = useState(stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "");
  const [binId, setBinId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [toBinId, setToBinId] = useState("");
  const [quantity, setQuantity] = useState("");

  // INV-14: a store either uses bins or does not, and the form asks the store
  // rather than a setting — the same question the server asks.
  const fromBins = bins[storeId] ?? [];
  const toBins = bins[toStoreId] ?? [];
  const chosenBin = fromBins.find((b) => b.id === binId);
  const inBin = binHoldings[`${itemId}:${binId}`] ?? 0;

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

        {/*
          onSubmit rather than action, because React resets a form with an
          action prop once the action resolves — including when it was refused.
          Every select here is controlled, so the reset put the DOM back to its
          defaults while the state driving the helper text kept the old values:
          a storeman who tried to issue more than was free to use got the right
          refusal above a form that had lost his item, store, bin and job, and
          still said "that bin holds 181" about an item no longer chosen.
          Losing his typing on a refusal is bad; contradicting itself is worse.
        */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
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
                {[...items, ...extraItems].map((i) => (
                  <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                ))}
              </select>
              {canAddItem && (
                <button type="button" onClick={() => setAdding("item")} className="mt-1 text-xs font-medium text-brand-blue-600 hover:underline">
                  + New item
                </button>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                {kind === "Transfer" ? "From store" : "Store"}
              </label>
              <select
                name="storeId" value={storeId}
                onChange={(e) => { setStoreId(e.target.value); setBinId(""); }}
                className="input" required
              >
                {[...stores, ...extraStores].map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
              {canAddStore && (
                <button type="button" onClick={() => setAdding("store")} className="mt-1 text-xs font-medium text-brand-blue-600 hover:underline">
                  + New store
                </button>
              )}
            </div>
          </div>

          {fromBins.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                {kind === "Transfer" ? "From bin" : "Bin"}
              </label>
              <select
                name="binId" value={binId}
                onChange={(e) => setBinId(e.target.value)} className="input" required
              >
                <option value="">Choose a bin&hellip;</option>
                {fromBins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {binLabel(b)}
                    {b.materialType ? ` — ${b.materialType}` : ""}
                    {itemId ? ` (holds ${(binHoldings[`${itemId}:${b.id}`] ?? 0).toLocaleString()})` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                This store is divided into bins, so every movement in it has to say which one.
                {binId && itemId && !isInward(kind) && kind !== "Transfer" && (
                  <> That bin holds <span className="font-medium text-ink">{inBin.toLocaleString()}</span>.</>
                )}
              </p>
              {chosenBin && item && binMismatch(chosenBin, item.category) && (
                <p className="mt-1 text-xs text-brand-gold">{binMismatch(chosenBin, item.category)}</p>
              )}
            </div>
          )}

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
              <select
                name="toStoreId" value={toStoreId}
                onChange={(e) => { setToStoreId(e.target.value); setToBinId(""); }}
                className="input" required
              >
                <option value="">Choose&hellip;</option>
                {stores.filter((s) => s.id !== storeId).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>

              {toBins.length > 0 && (
                <div className="mt-3">
                  <label className="mb-1 block text-sm font-medium text-ink">Into bin</label>
                  <select
                    name="toBinId" value={toBinId}
                    onChange={(e) => setToBinId(e.target.value)} className="input" required
                  >
                    <option value="">Choose a bin&hellip;</option>
                    {toBins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {binLabel(b)}{b.materialType ? ` — ${b.materialType}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">
                    Where it is going, which is a different place from where it came out of.
                  </p>
                </div>
              )}
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
                {[...parties, ...extraParties].map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
              {canAddParty && (
                <button type="button" onClick={() => setAdding("party")} className="mt-1 text-xs font-medium text-brand-blue-600 hover:underline">
                  + New supplier
                </button>
              )}
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

      {/* Outside the form above: a form element cannot be nested in another.
          What each one creates is selected straight away. */}
      {adding === "item" && (
        <ItemForm
          companyId={companyId}
          categories={itemCategories}
          inline
          controlled
          onClose={() => setAdding(null)}
          onCreated={(i: CreatedItem) => {
            setExtraItems((xs) => [...xs, { id: i.id, code: i.code, name: i.name, unitCode: i.unitCode }]);
            setItemId(i.id);
            setAdding(null);
          }}
        />
      )}
      {adding === "store" && (
        <StoreForm
          companyId={companyId}
          controlled
          onClose={() => setAdding(null)}
          onCreated={(s: CreatedStore) => {
            setExtraStores((xs) => [...xs, s]);
            setStoreId(s.id);
            setBinId("");
            setAdding(null);
          }}
        />
      )}
      {adding === "party" && (
        <PartyForm
          companyId={companyId}
          controlled
          onClose={() => setAdding(null)}
          onCreated={(p: CreatedParty) => {
            setExtraParties((xs) => [...xs, { id: p.id, code: p.code, name: p.name }]);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
