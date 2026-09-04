"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { exportDataset, exportEverything } from "@/app/(app)/export/actions";

function save(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads one dataset as a CSV that opens cleanly in Excel. */
export default function ExportButton({
  dataset,
  companyId,
  label = "Export",
}: {
  dataset: string;
  companyId: string;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function go() {
    setErr("");
    start(async () => {
      const r = await exportDataset(dataset, companyId);
      if (!r.ok || !r.content || !r.filename) {
        setErr(r.error || "Could not export");
        return;
      }
      // Excel needs a UTF-8 byte-order mark or it opens the file as Latin-1 and
      // mangles Arabic names. A leading U+FEFF does not survive the server-action
      // response, so the mark is added here, where the file is actually assembled.
      const bom = "\uFEFF";
      const body = r.content.charCodeAt(0) === 0xfeff ? r.content : bom + r.content;
      save(r.filename, new Blob([body], { type: "text/csv;charset=utf-8" }));
    });
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button type="button" onClick={go} disabled={pending} className="btn-ghost" title="Download as a CSV for Excel">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {label}
      </button>
      {err && <span className="mt-1 text-xs text-brand-gold">{err}</span>}
    </div>
  );
}

/** Administrators only: every dataset for this company, as a ZIP of CSVs. */
export function ExportAllButton({ companyId, label }: { companyId: string; label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function go() {
    setMsg(null);
    start(async () => {
      const r = await exportEverything(companyId);
      if (!r.ok || !r.base64 || !r.filename) {
        setMsg({ ok: false, text: r.error || "Could not export" });
        return;
      }
      // The ZIP arrives base64-encoded because a server action cannot return a Blob.
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      save(r.filename, new Blob([bytes], { type: "application/zip" }));
      setMsg({ ok: true, text: "Downloaded. It holds personal data — store it securely." });
    });
  }

  return (
    <div>
      <button type="button" onClick={go} disabled={pending} className="btn-navy" title="Download every record for this company">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {pending ? "Preparing…" : label ? `Export ${label}` : "Export all data"}
      </button>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-brand-green" : "text-brand-gold"}`}>{msg.text}</p>}
    </div>
  );
}
