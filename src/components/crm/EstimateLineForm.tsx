"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { saveEstimateLine } from "@/app/(app)/crm/estimates/actions";
import { BID_UNITS, BID_UNIT_HELP, isLumpSum, buildUp } from "@/lib/estimating";
import { money } from "@/lib/money";

export type EditingLine = {
  id: string;
  ref: string | null;
  description: string;
  unit: string;
  quantity: number;
  materialCost: number;
  labourHours: number;
  labourRate: number;
  plantHours: number;
  plantRate: number;
  subcontractCost: number;
  notes: string | null;
  takeoffs?: { id: string }[];
};

/**
 * One item in the bill of quantities, and what it costs (CRM-06, CRM-07).
 *
 * There is no box for a rate. The unit cost underneath adds itself up from the
 * four things that actually cost money, and it moves as they are typed — so an
 * estimator watches the rate they were going to write appear, rather than
 * writing it and hoping the build-up agrees.
 */
export default function EstimateLineForm({
  estimateId,
  row,
}: {
  estimateId: string;
  row?: EditingLine;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = !!row;

  const [unit, setUnit] = useState(row?.unit ?? "Piece");
  const [quantity, setQuantity] = useState(String(row?.quantity ?? ""));
  const [material, setMaterial] = useState(String(row?.materialCost ?? ""));
  const [labourHours, setLabourHours] = useState(String(row?.labourHours ?? ""));
  const [labourRate, setLabourRate] = useState(String(row?.labourRate ?? ""));
  const [plantHours, setPlantHours] = useState(String(row?.plantHours ?? ""));
  const [plantRate, setPlantRate] = useState(String(row?.plantRate ?? ""));
  const [subcontract, setSubcontract] = useState(String(row?.subcontractCost ?? ""));

  const hasTakeoff = (row?.takeoffs?.length ?? 0) > 0;

  const build = buildUp({
    materialCost: Number(material) || 0,
    labourHours: Number(labourHours) || 0,
    labourRate: Number(labourRate) || 0,
    plantHours: Number(plantHours) || 0,
    plantRate: Number(plantRate) || 0,
    subcontractCost: Number(subcontract) || 0,
  });
  const qty = isLumpSum(unit) ? 1 : Number(quantity) || 0;

  if (!open) {
    return editing ? (
      <button
        onClick={() => setOpen(true)}
        title="Edit"
        className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    ) : (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Add an item
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-10 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? "This item" : "What is being priced?"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setBusy(true);
            const res = await saveEstimateLine(fd);
            setBusy(false);
            if (res?.ok) setOpen(false);
            else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="estimateId" value={estimateId} />
          {editing && <input type="hidden" name="id" value={row!.id} />}

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">BOQ ref</label>
              <input name="ref" className="input font-mono" defaultValue={row?.ref ?? ""} placeholder="2.4.1" />
            </div>
            <div className="col-span-10">
              <label className="mb-1 block text-sm font-medium text-ink">What it is</label>
              <input
                name="description" className="input" required defaultValue={row?.description ?? ""}
                placeholder="Cable tray, 300mm, including supports"
              />
            </div>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-5">
              <label className="mb-1 block text-sm font-medium text-ink">How it is measured</label>
              <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="input">
                {BID_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">{BID_UNIT_HELP[unit]}</p>
            </div>
            <div className="col-span-4">
              <label className="mb-1 block text-sm font-medium text-ink">
                How much {isLumpSum(unit) && <span className="font-normal text-muted">— not asked</span>}
              </label>
              <input
                type="number" step="0.001" min="0" name="quantity" className="input"
                value={isLumpSum(unit) ? "" : quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isLumpSum(unit)}
                placeholder={isLumpSum(unit) ? "one package" : "0"}
                required={!isLumpSum(unit)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                What one {isLumpSum(unit) ? "package" : unit.toLowerCase()} costs
              </span>
              <span className="text-sm tabular-nums text-heading">{money(build.total)}</span>
            </div>

            <div className="space-y-3 p-3">
              {hasTakeoff && (
                <p className="rounded bg-brand-blue/10 p-2 text-xs text-ink">
                  This line has a takeoff, so its material cost comes from there and the box below is not used.
                  Change the takeoff to change the material.
                </p>
              )}

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">Material</label>
                  <input
                    type="number" step="0.01" min="0" name="materialCost" className="input"
                    value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="0.00"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">Labour hours</label>
                  <input
                    type="number" step="0.01" min="0" name="labourHours" className="input"
                    value={labourHours} onChange={(e) => setLabourHours(e.target.value)} placeholder="0"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">At an hourly rate of</label>
                  <input
                    type="number" step="0.01" min="0" name="labourRate" className="input"
                    value={labourRate} onChange={(e) => setLabourRate(e.target.value)} placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">Subcontract</label>
                  <input
                    type="number" step="0.01" min="0" name="subcontractCost" className="input"
                    value={subcontract} onChange={(e) => setSubcontract(e.target.value)} placeholder="0.00"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">Plant hours</label>
                  <input
                    type="number" step="0.01" min="0" name="plantHours" className="input"
                    value={plantHours} onChange={(e) => setPlantHours(e.target.value)} placeholder="0"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-sm font-medium text-ink">At an hourly rate of</label>
                  <input
                    type="number" step="0.01" min="0" name="plantRate" className="input"
                    value={plantRate} onChange={(e) => setPlantRate(e.target.value)} placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-brand-paper p-2 text-xs">
                <span className="text-muted">
                  Material {money(build.material)} · Labour {money(build.labour)} · Plant {money(build.plant)} ·
                  Subcontract {money(build.subcontract)}
                </span>
                <span className="tabular-nums text-ink">
                  {qty > 0 ? `${qty.toLocaleString()} × ${money(build.total)} = ` : ""}
                  <span className="font-semibold">{money(qty * build.total)}</span>
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
            <input name="notes" className="input" defaultValue={row?.notes ?? ""} placeholder="Assumptions, exclusions" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={busy} className="btn-primary disabled:opacity-50">
              {busy ? "Saving…" : "Save the item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
