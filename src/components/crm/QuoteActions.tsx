"use client";

import { useState } from "react";
import { Send, Undo2, Mail, FileSignature, ThumbsUp, ThumbsDown, X } from "lucide-react";
import {
  sendForApproval, pullBack, issue, revise, accept, decline,
} from "@/app/(app)/crm/quotations/actions";
import { poVariance } from "@/lib/quoting";
import { money } from "@/lib/money";

type Quote = {
  id: string;
  number: string;
  status: string;
  total: number;
  customerName: string;
  contactEmail?: string | null;
};

/**
 * Everything that can be done to a quotation, offered only when it can.
 *
 * One component rather than six, because what a quotation can do is entirely
 * decided by where it is, and six components each asking that question
 * separately is six places for the answer to drift.
 */
export default function QuoteActions({ quote }: { quote: Quote }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"" | "issue" | "accept" | "decline">("");

  const run = async (name: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    setBusy(name);
    const res = await fn();
    setBusy("");
    if (!res.ok) setError(res.error ?? "Could not do that");
    else setDialog("");
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {quote.status === "Draft" && (
          <button
            onClick={() => run("submit", () => sendForApproval(quote.id))}
            disabled={!!busy}
            className="btn-primary disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> {busy === "submit" ? "Sending…" : "Send for approval"}
          </button>
        )}

        {quote.status === "Awaiting approval" && (
          <button
            onClick={() => run("pull", () => pullBack(quote.id))}
            disabled={!!busy}
            className="btn-ghost disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" /> {busy === "pull" ? "Pulling back…" : "Pull it back"}
          </button>
        )}

        {quote.status === "Approved" && (
          <button onClick={() => setDialog("issue")} className="btn-primary">
            <Mail className="h-4 w-4" /> Issue to the customer
          </button>
        )}

        {quote.status === "Issued" && (
          <>
            <button onClick={() => setDialog("accept")} className="btn-primary">
              <ThumbsUp className="h-4 w-4" /> They ordered it
            </button>
            <button onClick={() => setDialog("decline")} className="btn-ghost">
              <ThumbsDown className="h-4 w-4" /> They said no
            </button>
          </>
        )}

        {(quote.status === "Issued" || quote.status === "Declined") && (
          <button
            onClick={() => run("revise", () => revise(quote.id))}
            disabled={!!busy}
            className="btn-ghost disabled:opacity-50"
          >
            <FileSignature className="h-4 w-4" /> {busy === "revise" ? "Revising…" : "Raise a revision"}
          </button>
        )}
      </div>

      {error && <span className="max-w-md text-right text-xs text-brand-gold">{error}</span>}

      {dialog === "issue" && (
        <Dialog title="Where is it going?" onClose={() => setDialog("")}>
          <form
            action={async (fd) => { await run("issue", () => issue(fd)); }}
            className="space-y-3 p-5"
          >
            <input type="hidden" name="quotationId" value={quote.id} />
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Sent to</label>
              <input
                name="issuedTo" className="input" required
                defaultValue={quote.contactEmail ?? ""}
                placeholder="procurement@customer.ae"
              />
            </div>

            {/*
              The one thing worth being straight about: there is no mail
              transport in this system, so nothing is sent from here. Saying so
              is better than a button that appears to send and does not.
            */}
            <p className="rounded bg-brand-gold/10 p-3 text-xs text-ink">
              <span className="font-semibold">This records that it went out; it does not send it.</span> There is
              no email server configured, so print the quotation and attach it to your own message. The record
              here is what the pipeline and the audit trail read.
            </p>

            <a
              href={`mailto:${quote.contactEmail ?? ""}?subject=${encodeURIComponent(`Quotation ${quote.number}`)}&body=${encodeURIComponent(`Dear Sir,\n\nPlease find our quotation ${quote.number} attached, for ${quote.customerName}.\n\nKind regards,`)}`}
              className="block rounded border border-line px-3 py-2 text-center text-xs text-brand-blue-600 hover:bg-line"
            >
              Open a draft in your mail program
            </a>

            {error && <p className="text-sm text-brand-gold">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDialog("")} className="btn-ghost">Cancel</button>
              <button disabled={!!busy} className="btn-primary disabled:opacity-50">
                {busy === "issue" ? "Recording…" : "Record that it went"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "accept" && <AcceptDialog quote={quote} busy={busy} error={error} run={run} close={() => setDialog("")} />}

      {dialog === "decline" && (
        <Dialog title="Why did they turn it down?" onClose={() => setDialog("")}>
          <form action={async (fd) => { await run("decline", () => decline(fd)); }} className="space-y-3 p-5">
            <input type="hidden" name="quotationId" value={quote.id} />
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">The reason</label>
              <textarea
                name="reason" className="input" rows={3} required
                placeholder="Beaten on price, programme too tight, scope changed — whatever it actually was"
              />
              <p className="mt-1 text-xs text-muted">
                Six months from now the file will say Declined, and this is the only thing that will explain it.
                The enquiry is marked lost with the same reason.
              </p>
            </div>
            {error && <p className="text-sm text-brand-gold">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDialog("")} className="btn-ghost">Cancel</button>
              <button disabled={!!busy} className="btn-primary disabled:opacity-50">
                {busy === "decline" ? "Recording…" : "Record it"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Recording the customer's order (CRM-17).
 *
 * The difference between what was quoted and what they ordered is shown while
 * it is being typed, because that is the moment to notice it. Afterwards it
 * becomes a contract value nobody questions.
 */
function AcceptDialog({
  quote, busy, error, run, close,
}: {
  quote: Quote;
  busy: string;
  error: string;
  run: (name: string, fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
  close: () => void;
}) {
  const [value, setValue] = useState(String(quote.total));
  const v = poVariance(quote.total, Number(value) || 0);

  return (
    <Dialog title="What did they order?" onClose={close}>
      <form action={async (fd) => { await run("accept", () => accept(fd)); }} className="space-y-3 p-5">
        <input type="hidden" name="quotationId" value={quote.id} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Their order number</label>
            <input name="poNumber" className="input font-mono" required placeholder="PO-88213" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Dated</label>
            <input
              type="date" name="poDate" className="input" required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink">For</label>
          <input
            type="number" step="0.01" min="0" name="poValue" className="input" required
            value={value} onChange={(e) => setValue(e.target.value)}
          />
        </div>

        <div className={`rounded p-3 text-xs ${v.matches ? "bg-brand-paper text-muted" : "bg-brand-gold/10 text-ink"}`}>
          {v.matches ? (
            <>Same as the {money(v.quoted)} quoted. The job will be created at that figure.</>
          ) : (
            <>
              <span className="font-semibold">
                {money(Math.abs(v.difference))} {v.direction === "more" ? "more" : "less"} than the{" "}
                {money(v.quoted)} quoted
              </span>{" "}
              ({Math.abs(v.fraction * 100).toFixed(1)}%). The job will be created at{" "}
              <span className="font-medium">their</span> figure, not ours — every margin report on this contract
              depends on getting that right.
            </>
          )}
        </div>

        {!v.matches && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acknowledged" className="mt-0.5" required />
            <span className="text-ink">Yes, that difference is right</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Job code</label>
            <input name="jobCode" className="input font-mono" placeholder={quote.number.replace(/\//g, "-")} />
            <p className="mt-1 text-xs text-muted">Leave empty to follow the quotation number.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Where their order lives</label>
            <input name="poRef" className="input" placeholder="Folder or file reference" />
          </div>
        </div>

        <p className="rounded bg-brand-paper p-3 text-xs text-muted">
          This creates the job, with the contract value they ordered and a budget in money and hours taken from
          the estimate — so job costing has something to compare against from its first day rather than a zero.
        </p>

        {error && <p className="text-sm text-brand-gold">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="btn-ghost">Cancel</button>
          <button disabled={!!busy} className="btn-primary disabled:opacity-50">
            {busy === "accept" ? "Creating the job…" : "Record it and open the job"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 whitespace-normal text-left">
      <div className="card w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold text-heading">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
