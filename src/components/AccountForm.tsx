"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createAccount, updateAccount } from "@/app/(app)/finance/actions";

const TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];
export type EditingAccount = { id: string; code: string; name: string; type: string };

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
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save" : "Add account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
