"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { createJournalEntry } from "@/app/(app)/finance/actions";

type Account = { id: string; code: string; name: string };
type Line = { accountId: string; debit: string; credit: string };

const empty = (): Line => ({ accountId: "", debit: "", credit: "" });

export default function JournalForm({ companyId, accounts }: { companyId: string; accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const [memo, setMemo] = useState("");
  const [voucherType, setVoucherType] = useState("Journal");
  const [party, setParty] = useState("");
  const [vat, setVat] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.round(totalDebit * 100) === Math.round(totalCredit * 100);

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function reset() {
    setLines([empty(), empty()]);
    setMemo("");
    setParty("");
    setVat("");
    setVoucherType("Journal");
    setError("");
  }

  async function submit() {
    setError("");
    setSaving(true);
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("memo", memo);
    fd.set("voucherType", voucherType);
    fd.set("partyName", party);
    fd.set("vatAmount", vat);
    fd.set("lines", JSON.stringify(lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))));
    const res = await createJournalEntry(fd);
    setSaving(false);
    if (res?.ok) {
      reset();
      setOpen(false);
    } else {
      setError(res?.error || "Could not post entry");
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New journal entry
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-12">
      <div className="card w-full max-w-2xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">New Journal Entry</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Voucher type</label>
              <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)} className="input">
                <option>Journal</option><option>Payment</option><option>Receipt</option><option>Contra</option><option>Sales</option><option>Purchase</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Party (optional)</label>
              <input value={party} onChange={(e) => setParty(e.target.value)} className="input" placeholder="Customer / supplier" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">VAT amount (optional)</label>
              <input type="number" value={vat} onChange={(e) => setVat(e.target.value)} className="input" placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Narration</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className="input" placeholder="e.g. Record client payment received" />
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[1fr,120px,120px,36px] gap-2 bg-brand-paper px-3 py-2 text-xs font-semibold uppercase text-muted">
              <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr,120px,120px,36px] items-center gap-2 border-t border-line px-3 py-2">
                <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className="input h-9 py-1.5 text-sm">
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
                <input type="number" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: "" })} className="input h-9 py-1.5 text-right text-sm" placeholder="0.00" />
                <input type="number" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: "" })} className="input h-9 py-1.5 text-right text-sm" placeholder="0.00" />
                <button onClick={() => setLines((ls) => ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls)} className="grid h-8 w-8 place-items-center rounded text-muted hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="grid grid-cols-[1fr,120px,120px,36px] gap-2 border-t border-line bg-brand-paper px-3 py-2 text-sm font-semibold">
              <button onClick={() => setLines((ls) => [...ls, empty()])} className="justify-self-start text-xs font-medium text-brand-blue-600 hover:underline">+ Add line</button>
              <span className="text-right text-ink">{totalDebit.toLocaleString()}</span>
              <span className="text-right text-ink">{totalCredit.toLocaleString()}</span>
              <span />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={balanced ? "text-sm font-medium text-brand-green-700" : "text-sm text-muted"}>
              {balanced ? "✓ Balanced" : `Difference: ${(totalDebit - totalCredit).toLocaleString()}`}
            </span>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={!balanced || saving} className="btn-primary disabled:opacity-50">
              {saving ? "Posting…" : "Post entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
