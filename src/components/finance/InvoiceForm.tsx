"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import InvoiceLines from "./InvoiceLines";
import { createInvoiceFromForm, updateInvoice } from "@/app/(app)/finance/invoices/actions";
import { DOC_TYPES } from "@/lib/invoice";
import { type VatTreatment } from "@/lib/vat";

type Line = {
  description: string; quantity: string; unitCode: string; unitPrice: string;
  discount: string; vatTreatment: VatTreatment; accountId: string; jobId: string;
};

/**
 * The draft editor.
 *
 * One form for a new document and for editing one that has not been issued, so
 * the two cannot drift apart. An issued invoice never reaches this component —
 * the page shows it read-only instead — because "editable unless" is a rule
 * somebody eventually forgets.
 */
export default function InvoiceForm({
  companyId,
  side,
  parties,
  accounts,
  jobs,
  vatRate,
  existing,
  invoices,
}: {
  companyId: string;
  side: "Sales" | "Purchase";
  parties: { id: string; code: string; name: string }[];
  accounts: { id: string; code: string; name: string }[];
  jobs: { id: string; code: string; name: string }[];
  vatRate: number;
  /** Present when editing a draft. */
  existing?: {
    id: string; docType: string; number: string; issueDate: string;
    partyId: string; jobId: string; notes: string; originalInvoiceId: string;
    lines: Line[];
  };
  /** Issued invoices this document could be a note against. */
  invoices: { id: string; number: string; partyName: string }[];
}) {
  const [error, action, pending] = useActionState(
    existing ? updateInvoice : createInvoiceFromForm,
    undefined,
  );
  const [docType, setDocType] = useState(existing?.docType ?? "Invoice");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="side" value={side} />
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Document</label>
            <select
              name="docType" value={docType} onChange={(e) => setDocType(e.target.value)}
              className="input" disabled={!!existing}
            >
              {DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {side === "Purchase" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Supplier&rsquo;s number</label>
              <input name="number" defaultValue={existing?.number ?? ""} className="input" placeholder="As printed on their invoice" />
              <p className="mt-1 text-xs text-muted">Their number, not ours — it is what an auditor looks for.</p>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Number</label>
              <input className="input bg-brand-paper" value={existing?.number ?? "Allocated when saved"} readOnly />
              <p className="mt-1 text-xs text-muted">Ours, in an unbroken series.</p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Date</label>
            <input type="date" name="issueDate" defaultValue={existing?.issueDate ?? today} className="input" required />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              {side === "Sales" ? "Customer" : "Supplier"}
            </label>
            <select name="partyId" defaultValue={existing?.partyId ?? ""} className="input" required>
              <option value="">Choose…</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">Payment terms come from their record.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Job (optional)</label>
            <select name="jobId" defaultValue={existing?.jobId ?? ""} className="input">
              <option value="">—</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
            </select>
          </div>

          {docType !== "Invoice" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Adjusts invoice</label>
              <select name="originalInvoiceId" defaultValue={existing?.originalInvoiceId ?? ""} className="input">
                <option value="">Choose…</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.number} — {i.partyName}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">
                Required. A note that does not say what it corrects cannot be issued.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-muted">Notes (printed on the document)</label>
          <input name="notes" defaultValue={existing?.notes ?? ""} className="input" placeholder="Purchase order number, payment terms, anything the customer needs to see" />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">Lines</h2>
        </div>
        <InvoiceLines accounts={accounts} jobs={jobs} vatRate={vatRate} initial={existing?.lines} />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? "Saving…" : existing ? "Save draft" : "Save as draft"}
        </button>
        <span className="text-sm text-muted">
          Saving does not post anything. Issue it when it is right.
        </span>
      </div>
    </form>
  );
}
