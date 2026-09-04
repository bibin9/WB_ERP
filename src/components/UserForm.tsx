"use client";

import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { createUser, updateUser } from "@/app/(app)/users/actions";

type Opt = { id: string; label: string };
export type EditingUser = { id: string; name: string; roleId?: string };

export default function UserForm({ companies, roles, user }: { companies: Opt[]; roles: Opt[]; user?: EditingUser }) {
  const [open, setOpen] = useState(false);
  const editing = !!user;

  const trigger = editing ? (
    <button onClick={() => setOpen(true)} title="Edit" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-line hover:text-ink">
      <Pencil className="h-4 w-4" />
    </button>
  ) : (
    <button className="btn-primary" onClick={() => setOpen(true)}>
      <Plus className="h-4 w-4" /> Add user
    </button>
  );

  if (!open) return trigger;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-12">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{editing ? "Edit User" : "Add User"}</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <form
          action={async (fd) => { editing ? await updateUser(fd) : await createUser(fd); setOpen(false); }}
          className="space-y-4 p-5"
        >
          {editing && <input type="hidden" name="id" value={user!.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Full name</label>
              <input name="name" className="input" defaultValue={user?.name ?? ""} placeholder="Jane Doe" required />
            </div>
            {!editing && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Email</label>
                <input name="email" type="email" className="input" placeholder="jane@company.com" required />
              </div>
            )}
            {editing && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Role (all companies)</label>
                <select name="roleId" className="input" defaultValue={user?.roleId ?? ""}>
                  <option value="">— keep current —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {!editing && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Temp password</label>
                  <input name="password" className="input" placeholder="Set a password" required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Role</label>
                  <select name="roleId" className="input" required defaultValue="">
                    <option value="" disabled>Select role…</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">Company access</label>
                <div className="grid grid-cols-2 gap-2">
                  {companies.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                      <input type="checkbox" name="companyIds" value={c.id} className="accent-[color:rgb(var(--brand-green))]" />
                      <span className="text-ink">{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save changes" : "Create user"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
