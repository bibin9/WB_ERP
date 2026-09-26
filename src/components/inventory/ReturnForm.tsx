"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { saveReturn } from "@/app/(app)/inventory/actions";
import StoreForm, { type CreatedStore } from "./StoreForm";
import { RETURN_CONDITIONS, CONDITION_HELP, checkReturn, returnVerdict } from "@/lib/returns";
import { binLabel } from "@/lib/bins";

type Line = { key: number; itemId: string; condition: string; quantity: string; notes: string; binId: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, itemId: "", condition: "Reusable", quantity: "", notes: "", binId: "" });

/**
 * Material coming back from site (INV-16).
 *
 * The condition on each line decides everything, so it is a visible choice on
 * the line rather than a tick hidden behind a menu, and what it means is
 * written underneath in the same words the library uses.
 *
 * The note is checked here as well as on the server — not to be trusted, but so
 * somebody with a lorry at the gate finds out that the job only has forty
 * metres out before they fill in the whole form and lose it.
 */
export default function ReturnForm({
  companyId,
  canAddStore = false,
  items,
  jobs,
  stores,
  bins = {},
  positions,
  averageCost,
}: {
  companyId: string;
  /** Whether this person keeps the stores list. */
  canAddStore?: boolean;
  items: { id: string; code: string; name: string; unitCode: string }[];
  jobs: { id: string; code: string; name: string }[];
  stores: { id: string; code: string; name: string; isDefault: boolean }[];
  /** The bins in each store, keyed by store id. Absent means the store has none. */
  bins?: Record<string, { id: string; code: string; zone: string | null; materialType: string | null }[]>;
  /** What each job has had out, keyed `jobId:itemId`. */
  positions: Record<string, { issued: number; returned: number }>;
  /** What a shelf says an item is worth, keyed `itemId:storeId`. */
  averageCost: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  // A store created here: held so the picker offers it before the page behind
  // this dialog has been told about it.
  const [addingStore, setAddingStore] = useState(false);
  const [extraStores, setExtraStores] = useState<{ id: string; code: string; name: string; isDefault: boolean }[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jobId, setJobId] = useState("");
  const [storeId, setStoreId] = useState(stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([blank()]);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const itemOf = (id: string) => items.find((i) => i.id === id);

  /** The bins in the store this note is going into. Empty means it has none. */
  const storeBins = bins[storeId] ?? [];

  /** What this job still has out, less anything claimed higher up this note. */
  const outstandingFor = (line: Line) => {
    if (!jobId || !line.itemId) return null;
    const pos = positions[`${jobId}:${line.itemId}`] ?? { issued: 0, returned: 0 };
    const claimedAbove = lines
      .slice(0, lines.findIndex((l) => l.key === line.key))
      .filter((l) => l.itemId === line.itemId)
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    return Math.max(0, Math.round((pos.issued - pos.returned - claimedAbove) * 1000) / 1000);
  };

  const complaintFor = (line: Line) => {
    if (!jobId || !line.itemId || !Number(line.quantity)) return "";
    // Said here rather than left to the posting, so the storeman is told while
    // he is still looking at the line rather than after he presses record.
    if (storeBins.length > 0 && line.condition === "Reusable" && !line.binId) {
      return "Say which bin it went into. This store is divided into bins, and the bin totals have to agree with the shelf.";
    }
    const pos = positions[`${jobId}:${line.itemId}`] ?? { issued: 0, returned: 0 };
    const claimedAbove = lines
      .slice(0, lines.findIndex((l) => l.key === line.key))
      .filter((l) => l.itemId === line.itemId)
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const res = checkReturn(
      Number(line.quantity),
      pos.issued,
      pos.returned + claimedAbove,
      itemOf(line.itemId)?.name ?? "this item",
    );
    return res.ok ? "" : res.error;
  };

  const filled = lines.filter((l) => l.itemId && Number(l.quantity) > 0);

  /**
   * What this note will actually do, or why it will do nothing.
   *
   * A note is all or nothing: one impossible line and postReturn writes none of
   * it, because half a return note leaves a job credited for material the
   * storekeeper is still holding. The summary used to be built from every
   * filled line regardless, so a line the screen had already refused still
   * showed up as "1 line going back on the shelf, crediting the job 835.54" —
   * a promise about a credit that was never going to happen.
   */
  const blocked = filled.filter((l) => complaintFor(l));
  const verdict =
    blocked.length > 0 || filled.length === 0
      ? ""
      : returnVerdict(
          filled.map((l) => ({
            condition: l.condition,
            quantity: Number(l.quantity),
            value: (Number(l.quantity) || 0) * (averageCost[`${l.itemId}:${storeId}`] ?? 0),
          })),
        );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Record a return
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-12 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What has come back from site?</h2>
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
            setSaving(true);
            fd.set("lines", JSON.stringify(filled));
            const res = await saveReturn(fd);
            setSaving(false);
            if (res?.ok) {
              setOpen(false);
              setLines([blank()]);
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Material still fit to use goes back on the shelf and the job is credited what it cost. Scrap — offcuts,
            damage, anything used up — is recorded but the job keeps the cost, because the job caused it. That is the
            difference between a job that wasted six drums of cable and one that wasted none.
          </p>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Coming back from</label>
              <select
                name="jobId" className="input" value={jobId}
                onChange={(e) => setJobId(e.target.value)} required
              >
                <option value="">Choose the job&hellip;</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Going into</label>
              <select
                name="storeId" className="input" value={storeId}
                onChange={(e) => setStoreId(e.target.value)} required
              >
                {[...stores, ...extraStores].map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
              {canAddStore && (
                <button type="button" onClick={() => setAddingStore(true)} className="mt-1 text-xs font-medium text-brand-blue-600 hover:underline">
                  + New store
                </button>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Date</label>
              <input
                type="date" name="date" className="input" required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Brought back by</label>
              <input name="returnedBy" className="input" placeholder="Who handed it over" required />
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              What came back
            </div>
            <div className="space-y-3 p-3">
              {lines.map((l) => {
                const out = outstandingFor(l);
                const complaint = complaintFor(l);
                return (
                  <div key={l.key} className="space-y-1">
                    <div className="grid grid-cols-12 gap-2">
                      <div className={storeBins.length > 0 ? "col-span-3" : "col-span-4"}>
                        <select
                          className="input h-9 py-1.5 text-sm"
                          value={l.itemId}
                          onChange={(e) => set(l.key, { itemId: e.target.value })}
                        >
                          <option value="">Choose an item&hellip;</option>
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className={storeBins.length > 0 ? "col-span-2" : "col-span-3"}>
                        <select
                          className="input h-9 py-1.5 text-sm"
                          value={l.condition}
                          onChange={(e) => set(l.key, { condition: e.target.value })}
                        >
                          {RETURN_CONDITIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      {/*
                        Only where the store is divided into bins, and only on a
                        reusable line — scrap never reaches a shelf. Without this
                        the store that most wants bins was the one store nothing
                        could be returned into: the movement was refused for a
                        bin the screen gave no way to name.
                      */}
                      {storeBins.length > 0 && (
                        <div className="col-span-2">
                          {l.condition === "Reusable" ? (
                            <select
                              className="input h-9 py-1.5 text-sm"
                              value={l.binId}
                              onChange={(e) => set(l.key, { binId: e.target.value })}
                            >
                              <option value="">Which bin&hellip;</option>
                              {storeBins.map((b) => (
                                <option key={b.id} value={b.id}>{binLabel(b)}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex h-9 items-center text-xs text-muted">no shelf</div>
                          )}
                        </div>
                      )}
                      <div className="col-span-2">
                        <input
                          type="number" step="0.001" min="0"
                          className="input h-9 py-1.5 text-sm"
                          value={l.quantity}
                          onChange={(e) => set(l.key, { quantity: e.target.value })}
                          placeholder="Qty"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          className="input h-9 py-1.5 text-sm"
                          value={l.notes}
                          onChange={(e) => set(l.key, { notes: e.target.value })}
                          placeholder="Notes"
                        />
                      </div>
                      <div className="col-span-1 flex items-center">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
                            title="Remove this line"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="pl-1 text-xs text-muted">
                      {CONDITION_HELP[l.condition]}
                      {out !== null && (
                        <span className="ml-1 text-ink">
                          This job still has {out.toLocaleString()}{" "}
                          {itemOf(l.itemId)?.unitCode ?? ""} out.
                        </span>
                      )}
                    </p>
                    {complaint && <p className="pl-1 text-xs text-brand-gold">{complaint}</p>}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, blank()])}
                className="text-xs text-brand-blue-600 hover:underline"
              >
                Add another line
              </button>
            </div>
          </div>

          {verdict && <p className="rounded bg-brand-paper p-3 text-xs text-ink">{verdict}</p>}

          {blocked.length > 0 && (
            <p className="rounded border border-brand-gold/40 bg-brand-gold/10 p-3 text-xs text-ink">
              <span className="font-medium">
                Nothing will be recorded until {blocked.length === 1 ? "that line is" : "those lines are"} sorted
                out.
              </span>{" "}
              A note goes on the shelf whole or not at all: posting the rest of it would credit the job for material
              still sitting on the back of the lorry.
            </p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" placeholder="Anything worth keeping with the note" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving || !filled.length} className="btn-primary disabled:opacity-50">
              {saving ? "Recording…" : "Record the return"}
            </button>
          </div>
        </form>
      </div>

      {/* Outside the form: a form element cannot be nested inside another. */}
      {addingStore && (
        <StoreForm
          companyId={companyId}
          controlled
          onClose={() => setAddingStore(false)}
          onCreated={(st: CreatedStore) => {
            setExtraStores((xs) => [...xs, st]);
            setStoreId(st.id);
            setAddingStore(false);
          }}
        />
      )}
    </div>
  );
}
