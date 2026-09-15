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

/** The people on file at this customer, so nobody types an address from memory. */
export type Contact = { id: string; name: string; role: string | null; email: string; isPrimary: boolean };

/**
 * Everything that can be done to a quotation, offered only when it can.
 *
 * One component rather than six, because what a quotation can do is entirely
 * decided by where it is, and six components each asking that question
 * separately is six places for the answer to drift.
 */
export default function QuoteActions({
  quote,
  contacts = [],
  mailReady = false,
  mailProblem,
}: {
  quote: Quote;
  contacts?: Contact[];
  /** Whether this company has a mail server configured and switched on. */
  mailReady?: boolean;
  /** Why not, if not. */
  mailProblem?: string | null;
}) {
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
            <Mail className="h-4 w-4" /> {mailReady ? "Email it to the customer" : "Issue to the customer"}
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
        <IssueDialog
          quote={quote}
          contacts={contacts}
          mailReady={mailReady}
          mailProblem={mailProblem}
          busy={busy}
          error={error}
          run={run}
          close={() => setDialog("")}
        />
      )}

      {dialog === "accept" && (
        <AcceptDialog quote={quote} busy={busy} error={error} run={run} close={() => setDialog("")} />
      )}

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
 * Sending the quotation to the customer (CRM-15).
 *
 * Addresses are ticked from the customer's own contacts rather than typed,
 * because an address typed from memory loses a letter and nobody notices for a
 * week. Anything not on file can still be typed, and should then be added to
 * the customer so the next person does not have to.
 *
 * Whether the system sends it or merely records a send made by hand depends on
 * whether a mail server has been set up. Both are real: a client with no mail
 * server still issues quotations, and their record should say so.
 */
function IssueDialog({
  quote, contacts, mailReady, mailProblem, busy, error, run, close,
}: {
  quote: Quote;
  contacts: Contact[];
  mailReady: boolean;
  mailProblem?: string | null;
  busy: string;
  error: string;
  run: (name: string, fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
  close: () => void;
}) {
  const withEmail = contacts.filter((c) => c.email);
  const [picked, setPicked] = useState<string[]>(() => {
    const primary = withEmail.find((c) => c.isPrimary) ?? withEmail[0];
    if (primary) return [primary.email];
    return quote.contactEmail ? [quote.contactEmail] : [];
  });
  const [extra, setExtra] = useState("");
  const [cc, setCc] = useState("");
  const [send, setSend] = useState(mailReady);

  const toggle = (email: string) =>
    setPicked((p) => (p.includes(email) ? p.filter((x) => x !== email) : [...p, email]));

  const typed = extra.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const to = [...picked, ...typed];

  return (
    <Dialog title="Send it to the customer" onClose={close}>
      <form action={async (fd) => { await run("issue", () => issue(fd)); }} className="space-y-3 p-5">
        <input type="hidden" name="quotationId" value={quote.id} />
        <input type="hidden" name="issuedTo" value={to.join(", ")} />
        <input type="hidden" name="cc" value={cc} />
        {send && <input type="hidden" name="send" value="on" />}

        {withEmail.length > 0 ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Who at {quote.customerName}
            </label>
            <div className="space-y-1 rounded-lg border border-line p-2">
              {withEmail.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-line"
                >
                  <input type="checkbox" checked={picked.includes(c.email)} onChange={() => toggle(c.email)} />
                  <span className="text-ink">{c.name}</span>
                  {c.role && <span className="text-xs text-muted">{c.role}</span>}
                  <span className="ml-auto text-xs text-muted">{c.email}</span>
                  {c.isPrimary && (
                    <span className="rounded bg-brand-blue/10 px-1.5 py-0.5 text-xs text-brand-blue-600">main</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded bg-brand-paper p-3 text-xs text-muted">
            No contacts are on file for {quote.customerName}. Add them under Finance &rarr; Parties and they will
            be offered here next time, so nobody has to type an address from memory.
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-ink">
            Anyone else <span className="font-normal text-muted">(comma separated)</span>
          </label>
          <input
            className="input" value={extra} onChange={(e) => setExtra(e.target.value)}
            placeholder="someone@customer.ae"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Copy to</label>
          <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
        </div>

        {mailReady ? (
          <label className="flex items-start gap-2 rounded bg-brand-paper p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={send} onChange={(e) => setSend(e.target.checked)} />
            <span>
              <span className="font-medium text-ink">Send it now from the system</span>
              <span className="mt-0.5 block text-xs text-muted">
                Goes out through your own mail server. Untick if you have already sent it yourself and are only
                recording that here. If the mail server refuses it, the quotation is not marked as issued.
              </span>
            </span>
          </label>
        ) : (
          <p className="rounded bg-brand-gold/10 p-3 text-xs text-ink">
            <span className="font-semibold">This will record the send, not make it.</span>{" "}
            {mailProblem ?? "No mail server is set up for this company."} Once one is configured under Settings
            &rarr; Email, quotations go out from here with one click.
          </p>
        )}

        <p className="text-xs text-muted">
          {to.length === 0 ? "Nobody selected yet." : `Going to ${to.join(", ")}`}
        </p>

        {error && <p className="text-sm text-brand-gold">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="btn-ghost">Cancel</button>
          <button disabled={!!busy || to.length === 0} className="btn-primary disabled:opacity-50">
            {busy === "issue" ? (send ? "Sending…" : "Recording…") : send ? "Send it" : "Record that it went"}
          </button>
        </div>
      </form>
    </Dialog>
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
