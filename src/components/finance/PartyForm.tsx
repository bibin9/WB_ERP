"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createParty, updateParty } from "@/app/(app)/finance/parties/actions";

const TYPES = ["Customer", "Supplier", "Both"];

export type EditingParty = {
  id: string;
  name: string;
  type: string;
  trn: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  creditDays: number;
};

export default function PartyForm({ companyId, party }: { companyId: string; party?: EditingParty }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = !!party;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="btn-primary">
      <Plus className="h-4 w-4" /> Add customer / supplier
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? `Edit ${party!.name}` : "Add customer / supplier"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <form
          action={async (fd) => {
            setError("");
            setSaving(true);
            const res = editing ? await updateParty(fd) : await createParty(fd);
            setSaving(false);
            if (res.ok) setOpen(false);
            else setError(res.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          {editing ? <input type="hidden" name="id" value={party!.id} /> : <input type="hidden" name="companyId" value={companyId} />}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Name</label>
              <input name="name" className="input" defaultValue={party?.name ?? ""} placeholder="Al Habtoor Construction LLC" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Type</label>
              <select name="type" className="input" defaultValue={party?.type ?? "Customer"}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">TRN</label>
              <input name="trn" className="input" defaultValue={party?.trn ?? ""} placeholder="100123456700003" inputMode="numeric" />
              <p className="mt-1 text-xs text-muted">15 digits, from their trade licence. Needed on a tax invoice.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Credit days</label>
              <input name="creditDays" type="number" min="0" max="365" className="input" defaultValue={party?.creditDays ?? 0} placeholder="30" />
              <p className="mt-1 text-xs text-muted">Payment terms. Used to flag an invoice as overdue.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Contact person</label>
              <input name="contactPerson" className="input" defaultValue={party?.contactPerson ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
              <input name="phone" className="input" defaultValue={party?.phone ?? ""} placeholder="+971 4 000 0000" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input name="email" type="email" className="input" defaultValue={party?.email ?? ""} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Address</label>
            <textarea name="address" className="input" rows={2} defaultValue={party?.address ?? ""} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : editing ? "Save" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
