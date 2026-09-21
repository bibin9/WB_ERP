"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { setBooksLock } from "@/app/(app)/finance/settings/actions";

/**
 * The period lock, on Finance Settings, for whoever closes the books.
 *
 * Plain words on purpose: most people who open this have filed a VAT return
 * and want to be sure nobody can change the figures behind it.
 */
export default function BooksLockForm({ companyId, companyCode, lockedTo }: { companyId: string; companyCode: string; lockedTo: string | null }) {
  const [date, setDate] = useState(lockedTo ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const save = (value: string) =>
    start(async () => {
      const res = await setBooksLock(companyId, value);
      setMessage(res.ok
        ? { ok: true, text: value ? `${companyCode}'s books are locked up to ${value}.` : `${companyCode}'s books are open again.` }
        : { ok: false, text: res.error ?? "That did not save." });
    });

  return (
    <div className="card mb-5 p-5">
      <div className="mb-2 flex items-center gap-2 text-heading">
        <Lock className="h-5 w-5" />
        <h2 className="font-semibold">Lock the books</h2>
      </div>
      <p className="mb-3 max-w-prose text-sm text-muted">
        After a VAT return is filed, lock the period so the figures behind it cannot change. Nothing can be
        posted on or before the date you choose — a late entry has to be dated after it. Moving the date back
        reopens a closed period; that is recorded in the audit log.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink" htmlFor="books-locked-to">Locked up to and including</label>
          <input id="books-locked-to" type="date" className="input" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={pending || !date || date === lockedTo} onClick={() => save(date)}>
          {pending ? "Saving…" : "Lock"}
        </button>
        {lockedTo && (
          <button className="btn-ghost" disabled={pending} onClick={() => { setDate(""); save(""); }}>
            Unlock
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{lockedTo ? `Currently locked up to ${lockedTo}.` : "Not locked: any date can be posted to."}</p>
      {message && (
        <p role="status" className={`mt-2 text-sm ${message.ok ? "text-brand-green-700" : "text-red-700"}`}>{message.text}</p>
      )}
    </div>
  );
}
