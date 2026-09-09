"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { issue } from "@/app/(app)/finance/invoices/actions";

/**
 * Issuing a draft.
 *
 * The confirmation is not politeness. Issuing posts to the ledger, consumes a
 * number in a series that must have no holes, and produces a document that can
 * only be undone by a credit note — so it asks once, and says what it is about
 * to do rather than "are you sure?".
 *
 * When the document is not ready the server sends back what is missing, field
 * by field, and every one is listed. Fixing them one refusal at a time is how
 * an accountant comes to hate a system.
 */
export default function IssueInvoice({ id, docType, number }: { id: string; docType: string; number: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      const res = await issue(id);
      if (res.ok) {
        setConfirming(false);
        setError(undefined);
        setProblems([]);
        router.refresh();
      } else {
        setError(res.error);
        setProblems(res.problems ?? []);
        setConfirming(false);
      }
    });

  return (
    <div>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn-primary" disabled={pending}>
          <CheckCircle2 className="h-4 w-4" /> Issue {docType.toLowerCase()}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-3 py-2">
          <span className="text-sm text-ink">
            Issue {number}? It posts to the ledger and cannot be edited afterwards.
          </span>
          <button type="button" onClick={go} disabled={pending} className="btn-primary h-8 px-3 text-sm">
            {pending ? "Issuing…" : "Yes, issue it"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-8 rounded-lg border border-line px-3 text-sm text-muted hover:text-ink"
          >
            Not yet
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{error}</p>
              {problems.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {problems.map((p, i) => <li key={`${p.field}-${i}`}>{p.message}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
