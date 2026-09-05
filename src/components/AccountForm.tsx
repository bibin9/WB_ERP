"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createAccount, updateAccount } from "@/app/(app)/finance/actions";

const TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];
export type EditingAccount = { id: string; code: string; name: string; type: string; openingBalance: number; controlType: string | null };

export default function AccountForm({ companyId, account }: { companyId: string; account?: EditingAccount }) {
  const [open, setOpen] = useState(false);
  const editing = !!account;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-heading hover:border-brand-blue">
      <Plus className="h-3.5 w-3.5" /> Add account
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-20">
      <div className="card w-full max-w-sm p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? "Edit Account" : "Add Account"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => { editing ? await updateAccount(fd) : await createAccount(fd); setOpen(false); }}
          className="space-y-4 p-5"
        >
          {editing ? <input type="hidden" name="id" value={account!.id} /> : <input type="hidden" name="companyId" value={companyId} />}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Code</label>
              <input name="code" className="input" defaultValue={account?.code ?? ""} placeholder="1000" maxLength={10} disabled={editing} required={!editing} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Name</label>
              <input name="name" className="input" defaultValue={account?.name ?? ""} placeholder="Cash at Bank" required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Type</label>
            <select name="type" className="input" defaultValue={account?.type ?? "Asset"}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Control account</label>
            <select name="controlType" className="input" defaultValue={account?.controlType ?? ""}>
              <option value="">Not a control account</option>
              <option value="Receivable">Receivable — money customers owe us</option>
              <option value="Payable">Payable — money we owe suppliers</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              Marking Accounts Receivable and Accounts Payable here is what lets the Outstanding &amp; Ageing
              report work out who owes what.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Opening balance</label>
            <div className="flex gap-2">
              <input
                name="openingAmount"
                type="number"
                step="0.01"
                min="0"
                className="input"
                defaultValue={account ? Math.abs(account.openingBalance) || "" : ""}
                placeholder="0.00"
              />
              <select name="openingSide" className="input w-28" defaultValue={account && account.openingBalance < 0 ? "Cr" : "Dr"}>
                <option value="Dr">Dr</option>
                <option value="Cr">Cr</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-muted">
              The balance this account already had when you moved onto the system. Leave blank for a new account.
              Cash, bank, stock and money owed to you are <span className="font-medium">Dr</span>; loans, money you
              owe and capital are <span className="font-medium">Cr</span>.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save" : "Add account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
