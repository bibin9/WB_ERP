"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveTakeoffLine } from "@/app/(app)/crm/estimates/actions";
import { money } from "@/lib/money";

export type EditingTakeoff = {
  id: string;
  itemId: string | null;
  description: string;
  unitCode: string;
  perUnit: number;
  wastage: number;
  unitCost: number;
};

/**
 * What one unit of a bid item actually consumes (CRM-05).
 *
 * Wastage is entered as a percentage because that is how people say it, and
 * turned into a fraction on the way in. It is asked for on every line rather
 * than added once at the end, because it differs by material — five per cent
 * on a cable drum is a rounding error and five per cent on structural steel is
 * a week of somebody's wages.
 */
export default function TakeoffForm({
  lineId,
  items,
  row,
}: {
  lineId: string;
  items: { id: string; code: string; name: string; unitCode: string; standardCost: number }[];
  row?: EditingTakeoff;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = !!row;

  const [description, setDescription] = useState(row?.description ?? "");
  const [unitCode, setUnitCode] = useState(row?.unitCode ?? "EA");
  const [perUnit, setPerUnit] = useState(String(row?.perUnit ?? ""));
  const [wastage, setWastage] = useState(String(row ? row.wastage * 100 : ""));
  const [unitCost, setUnitCost] = useState(String(row?.unitCost ?? ""));

  const pick = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setDescription(`${item.code} — ${item.name}`);
    setUnitCode(item.unitCode);
    if (item.standardCost > 0) setUnitCost(String(item.standardCost));
  };

  const per = Number(perUnit) || 0;
  const waste = Math.max(0, Number(wastage) || 0) / 100;
  const cost = Number(unitCost) || 0;
  const buy = per * (1 + waste);

  if (!open) {
    return editing ? (
      <button
        onClick={() => setOpen(true)}
        title="Edit"
        className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-line hover:text-ink"
      >
        <Pencil className="h-3 w-3" />
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-blue-600 hover:bg-line"
      >
        <Plus className="h-3 w-3" /> Add material
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What does one unit need?</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await saveTakeoffLine(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="lineId" value={lineId} />
          {editing && <input type="hidden" name="id" value={row!.id} />}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">From the catalogue</label>
            <select name="itemId" className="input" defaultValue={row?.itemId ?? ""} onChange={(e) => pick(e.target.value)}>
              <option value="">Not a catalogue item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.code} — {i.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Material</label>
            <input
              name="description" className="input" required
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Cable tray, 300mm perforated"
            />
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-3">
              <label className="mb-1 block text-sm font-medium text-ink">How much</label>
              <input
                type="number" step="0.001" min="0" name="perUnit" className="input" required
                value={perUnit} onChange={(e) => setPerUnit(e.target.value)} placeholder="1"
              />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-sm font-medium text-ink">Unit</label>
              <input
                name="unitCode" className="input"
                value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="MTR"
              />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-sm font-medium text-ink">Wastage %</label>
              <input
                type="number" step="0.1" min="0" max="100" name="wastage" className="input"
                value={wastage} onChange={(e) => setWastage(e.target.value)} placeholder="5"
              />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-sm font-medium text-ink">Cost each</label>
              <input
                type="number" step="0.01" min="0" name="unitCost" className="input"
                value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00"
              />
            </div>
          </div>

          <div className="rounded bg-brand-paper p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted">
                The drawings need {per.toLocaleString()} {unitCode}; with wastage you buy{" "}
                <span className="font-medium text-ink">{buy.toLocaleString(undefined, { maximumFractionDigits: 3 })} {unitCode}</span>
              </span>
              <span className="tabular-nums text-ink">{money(buy * cost)} per unit</span>
            </div>
            {waste > 0 && (
              <p className="mt-1 text-muted">
                The extra {(buy - per).toLocaleString(undefined, { maximumFractionDigits: 3 })} {unitCode} is the
                offcuts — real money, and already proven on the returns note.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
