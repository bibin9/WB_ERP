"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Send, X } from "lucide-react";
import { previewDocument, send } from "@/app/(app)/finance/einvoicing/actions";

/**
 * Preview, then transmit.
 *
 * The preview is not a nicety. Under the five-corner model a refusal comes back
 * asynchronously from a system nobody here controls, hours after the customer
 * already has the invoice — so seeing the document, and being told what a
 * validator would object to, has to be possible before anything leaves.
 *
 * Sending asks once and says what it will do. A transmitted document is in a
 * tax authority's hands and cannot be recalled.
 */
export default function TransmitInvoice({
  id,
  number,
  status,
  maySend,
}: {
  id: string;
  number: string;
  status: string;
  maySend: boolean;
}) {
  const router = useRouter();
  const [xml, setXml] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const done = ["Accepted", "Delivered"].includes(status);

  const preview = () =>
    start(async () => {
      setError(undefined);
      setProblems([]);
      const res = await previewDocument(id);
      if (res.ok) setXml(res.xml);
      else {
        setXml(null);
        setError(res.error);
        setProblems(res.problems ?? []);
      }
    });

  const transmit = () =>
    start(async () => {
      const res = await send(id);
      setConfirming(false);
      if (!res.ok) setError(res.error);
      else {
        setError(undefined);
        setXml(null);
      }
      router.refresh();
    });

  return (
    <div className="min-w-[13rem]">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={preview}
          disabled={pending}
          className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-xs text-muted hover:bg-brand-paper hover:text-ink disabled:opacity-50"
        >
          <Eye className="h-3.5 w-3.5" /> Preview
        </button>

        {maySend && !done && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-brand-paper disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" /> {status === "Failed" || status === "Rejected" ? "Retry" : "Send"}
          </button>
        )}

        {confirming && (
          <span className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={transmit}
              disabled={pending}
              className="rounded bg-brand-navy px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              {pending ? "Sending…" : `Send ${number}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-ink"
            >
              Cancel
            </button>
          </span>
        )}
      </div>

      {confirming && (
        <p className="mt-1 text-[11px] text-muted">
          It goes to the tax authority through your provider and cannot be recalled.
        </p>
      )}

      {error && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          <p className="font-medium">{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {problems.map((p, i) => <li key={`${p.field}-${i}`}>{p.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {xml && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-muted">The document that would be sent</span>
            <button type="button" onClick={() => setXml(null)} aria-label="Close preview" className="text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-72 overflow-auto rounded border border-line bg-brand-paper p-2 text-[10px] leading-relaxed text-ink">
            {xml}
          </pre>
        </div>
      )}
    </div>
  );
}
