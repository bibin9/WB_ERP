"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveLead } from "@/app/(app)/crm/actions";
import { LEAD_SOURCES, qualify } from "@/lib/leads";

/**
 * Logging an enquiry (CRM-11).
 *
 * The five qualification questions are on the form but none of them is
 * required, and the count updates as they are answered. That is the whole
 * point: an enquiry that arrives at five on a Friday should be logged in
 * thirty seconds with a name and a title, and the rest filled in when somebody
 * knows it. A form that demands the budget before it will save is a form that
 * gets bypassed, and then the enquiry lives on a notepad.
 */
export default function LeadForm({
  companyId,
  parties,
}: {
  companyId: string;
  parties: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [budgetStated, setBudget] = useState("");
  const [decisionMaker, setDecisionMaker] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [scopeDefined, setScope] = useState(false);

  // Site visits are recorded on the enquiry once it exists, so a brand new one
  // can never have one — the count reflects that honestly rather than hiding it.
  const q = qualify({
    stage: "New",
    budgetStated: Number(budgetStated) || 0,
    decisionMaker,
    requiredBy: requiredBy || null,
    siteReportOn: null,
    scopeDefined,
  });

  const pickParty = (id: string) => {
    const p = parties.find((x) => x.id === id);
    if (p) setCustomerName(p.name);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" /> Log an enquiry
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-10 whitespace-normal text-left">
      <div className="card w-full max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">What has come in?</h2>
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
            setSaving(true);
            const res = await saveLead(fd);
            setSaving(false);
            if (res?.ok) {
              setOpen(false);
              setCustomerName(""); setBudget(""); setDecisionMaker(""); setRequiredBy(""); setScope(false);
            } else setError(res?.error || "Could not save");
          }}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />

          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            Only the title and who it is from are needed. Everything below can be filled in later &mdash; the
            enquiry will just say how much is still unknown.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What is it for</label>
            <input
              name="title" className="input" required
              placeholder="Substation fit-out, Mussafah"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Existing customer</label>
              <select name="partyId" className="input" onChange={(e) => pickParty(e.target.value)}>
                <option value="">Not on the list yet</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Who it is from</label>
              <input
                name="customerName" className="input" required
                value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Emirates Steel"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Contact</label>
              <input name="contactName" className="input" placeholder="Who is asking" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Email</label>
              <input type="email" name="contactEmail" className="input" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
              <input name="contactPhone" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Worth roughly</label>
              <input type="number" step="0.01" min="0" name="estimatedValue" className="input" placeholder="0.00" />
              <p className="mt-1 text-xs text-muted">Your figure, weighted by stage in the forecast.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Where it came from</label>
              <select name="source" className="input">
                <option value="">Not recorded</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Who is chasing it</label>
              <input name="ownerName" className="input" placeholder="Defaults to you" />
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                What is known so far
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  q.answered >= 3 ? "bg-brand-blue/10 text-brand-blue-600" : "bg-brand-gold/10 text-brand-gold"
                }`}
              >
                {q.answered} of {q.of}
              </span>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Budget they stated</label>
                  <input
                    type="number" step="0.01" min="0" name="budgetStated" className="input"
                    value={budgetStated} onChange={(e) => setBudget(e.target.value)} placeholder="If they said"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Who decides</label>
                  <input
                    name="decisionMaker" className="input"
                    value={decisionMaker} onChange={(e) => setDecisionMaker(e.target.value)}
                    placeholder="Name, not a department"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink">Needed by</label>
                  <input
                    type="date" name="requiredBy" className="input"
                    value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)}
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox" name="scopeDefined" className="mt-0.5"
                  checked={scopeDefined} onChange={(e) => setScope(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-ink">The scope is defined</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Drawings, a bill of quantities or a written specification &mdash; something an estimate can be
                    built on.
                  </span>
                </span>
              </label>

              <p className="text-xs text-muted">
                The fifth question is whether anybody has been to site. Record the visit on the enquiry once it is
                logged.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Who else is bidding</label>
            <input name="competitors" className="input" placeholder="As far as anybody knows" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">What they asked for</label>
            <textarea name="description" className="input" rows={3} placeholder="In their words, if you have them" />
          </div>

          {error && <p className="text-sm text-brand-gold">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Logging…" : "Log the enquiry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
