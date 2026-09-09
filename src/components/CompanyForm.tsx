"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createCompany, updateCompany } from "@/app/(app)/companies/actions";
import LogoField from "@/components/LogoField";

export type EditingCompany = { id: string; name: string; baseCurrency: string; fyStartMonth: number; openingAsOf: string | null; booksLockedTo: string | null; logoUrl: string | null; emiratisationSector: boolean
  vatTRN?: string | null;
  addressLine?: string | null;
  city?: string | null;
  emirate?: string | null;
};

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
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-16 whitespace-normal text-left">
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
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">VAT registration number (TRN)</label>
            <input name="vatTRN" className="input font-mono" defaultValue={company?.vatTRN ?? ""} placeholder="15 digits" maxLength={20} />
            <p className="mt-1 text-xs text-muted">
              A tax invoice is not valid without it, and no invoice can be issued until it is here.
              Separate from the corporate tax number, which lives on Finance &rarr; Tax &rarr; Corporate Tax.
            </p>
          </div>

          {/* Split rather than one line, because a transmitted eInvoice carries
              the parts separately and the emirate as its own field. */}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Address</label>
            <input name="addressLine" className="input" defaultValue={company?.addressLine ?? ""} placeholder="Street, building, PO box" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">City</label>
            <input name="city" className="input" defaultValue={company?.city ?? ""} placeholder="Sharjah" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Emirate</label>
            <select name="emirate" className="input" defaultValue={company?.emirate ?? ""}>
              <option value="">Choose…</option>
              <option key="Abu Dhabi">Abu Dhabi</option>
              <option key="Dubai">Dubai</option>
              <option key="Sharjah">Sharjah</option>
              <option key="Ajman">Ajman</option>
              <option key="Umm Al Quwain">Umm Al Quwain</option>
              <option key="Ras Al Khaimah">Ras Al Khaimah</option>
              <option key="Fujairah">Fujairah</option>
            </select>
            <p className="mt-1 text-xs text-muted">Carried as its own field on an electronic invoice.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Logo for printed reports</label>
            <LogoField defaultValue={company?.logoUrl ?? ""} />

            {/* At 20 to 49 employees the Emiratisation target applies only to
                the fourteen sectors MOHRE has named — construction, real
                estate, healthcare, hospitality and the rest. */}
            <label className="flex items-start gap-2 rounded-lg border border-line p-3">
              <input type="checkbox" name="emiratisationSector" defaultChecked={company?.emiratisationSector} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-ink">In an Emiratisation priority sector</span>
                <span className="block text-xs text-muted">
                  Construction, real estate, healthcare, hospitality, information and communications,
                  financial activities and the other named sectors. It decides the target between 20 and
                  49 employees.
                </span>
              </span>
            </label>
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
