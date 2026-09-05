"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createCompany, updateCompany } from "@/app/(app)/companies/actions";

export type EditingCompany = { id: string; name: string; baseCurrency: string; fyStartMonth: number; openingAsOf: string | null; booksLockedTo: string | null };

export default function CompanyForm({ company }: { company?: EditingCompany }) {
  const [open, setOpen] = useState(false);
  const editing = !!company;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-4 w-4" />
    </button>
  ) : (
    <button className="btn-primary" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" /> Add company
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-16">
      <div className="card w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? "Edit Company" : "Add Company"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => { editing ? await updateCompany(fd) : await createCompany(fd); setOpen(false); }}
          className="space-y-4 p-5"
        >
          {editing && <input type="hidden" name="id" value={company!.id} />}
          {!editing && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input uppercase" placeholder="WBE" maxLength={8} required />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Company name</label>
            <input name="name" className="input" defaultValue={company?.name ?? ""} placeholder="WB Engineering" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Base currency</label>
            <input name="baseCurrency" className="input" defaultValue={company?.baseCurrency ?? "AED"} maxLength={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Financial year starts</label>
              <select name="fyStartMonth" className="input" defaultValue={String(company?.fyStartMonth ?? 1)}>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">Most UAE companies use January.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Opening balances as at</label>
              <input name="openingAsOf" type="date" className="input" defaultValue={company?.openingAsOf ?? ""} />
              <p className="mt-1 text-xs text-muted">The date you moved onto this system. Leave blank if the balances are brought forward from before.</p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Books closed up to</label>
            <input name="booksLockedTo" type="date" className="input" defaultValue={company?.booksLockedTo ?? ""} />
            <p className="mt-1 text-xs text-muted">
              Nothing can be posted on or before this date. Set it once a VAT return is filed or a month is
              closed, so the figures behind it cannot change. Leave blank while the books are open.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save changes" : "Add company"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
