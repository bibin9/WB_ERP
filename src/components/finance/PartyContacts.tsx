"use client";

import { useState } from "react";
import { Plus, X, Pencil, Trash2, Mail } from "lucide-react";
import { savePartyContact, deletePartyContact } from "@/app/(app)/finance/parties/actions";
import { looksLikeEmail } from "@/lib/mailsettings";

export type Contact = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

/**
 * The people at a customer or supplier (master data).
 *
 * Party already carried one email, which is enough until somebody has to send
 * a quotation to procurement and copy the project manager. These are what the
 * quotation screen offers as recipients, so an address is ticked rather than
 * remembered.
 */
export default function PartyContacts({
  partyId,
  partyName,
  contacts,
}: {
  partyId: string;
  partyName: string;
  contacts: Contact[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  const start = (c: Contact | null) => {
    setEditing(c);
    setEmail(c?.email ?? "");
    setError("");
    setOpen(true);
  };

  const emailLooksWrong = email.trim().length > 0 && !looksLikeEmail(email.trim());

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {contacts.length === 0 && <span className="text-xs text-muted">No contacts</span>}
        {contacts.map((c) => (
          <span
            key={c.id}
            title={[c.role, c.email, c.phone].filter(Boolean).join(" · ")}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
              !c.isActive
                ? "bg-line text-muted/60 line-through"
                : c.isPrimary
                  ? "bg-brand-blue/10 text-brand-blue-600"
                  : "bg-line text-muted"
            }`}
          >
            {c.email && <Mail className="h-3 w-3" />}
            {c.name}
            <button
              onClick={() => start(c)}
              title="Edit"
              className="grid h-4 w-4 place-items-center rounded hover:bg-surface"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <button
          onClick={() => start(null)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-blue-600 hover:bg-line"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-20 whitespace-normal text-left">
          <div className="card w-full max-w-md p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h2 className="font-semibold text-heading">{editing ? editing.name : "Add a contact"}</h2>
                <p className="text-xs text-muted">{partyName}</p>
              </div>
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
                setBusy(true);
                const res = await savePartyContact(fd);
                setBusy(false);
                if (res.ok) setOpen(false);
                else setError(res.error ?? "Could not save");
              }}
              className="space-y-3 p-5"
            >
              {editing ? (
                <input type="hidden" name="id" value={editing.id} />
              ) : (
                <input type="hidden" name="partyId" value={partyId} />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Name</label>
                  <input name="name" className="input" required defaultValue={editing?.name ?? ""} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">What they do</label>
                  <input
                    name="role" className="input" defaultValue={editing?.role ?? ""}
                    placeholder="Procurement"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Email</label>
                  <input
                    type="email" name="email" className="input"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                  {emailLooksWrong && (
                    <p className="mt-1 text-xs text-brand-gold">That does not look like an email address.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
                  <input name="phone" className="input" defaultValue={editing?.phone ?? ""} />
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox" name="isPrimary" className="mt-0.5"
                  defaultChecked={editing?.isPrimary ?? contacts.length === 0}
                />
                <span>
                  <span className="font-medium text-ink">The main contact</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Ticked by default when a quotation goes to this customer. Only one can be the main one.
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Notes</label>
                <input name="notes" className="input" defaultValue={editing?.notes ?? ""} />
              </div>

              {editing && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isActive" defaultChecked={editing.isActive} />
                  <span className="text-ink">Still there</span>
                </label>
              )}

              {error && <p className="text-sm text-brand-gold">{error}</p>}

              <div className="flex items-center justify-between pt-1">
                {editing ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true);
                      const res = await deletePartyContact(editing.id);
                      setBusy(false);
                      if (res.ok) setOpen(false);
                      else setError(res.error ?? "Could not remove");
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs text-brand-gold hover:underline disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                ) : (
                  <span />
                )}
                <span className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
                  <button disabled={busy || emailLooksWrong} className="btn-primary disabled:opacity-50">
                    {busy ? "Saving…" : "Save"}
                  </button>
                </span>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
