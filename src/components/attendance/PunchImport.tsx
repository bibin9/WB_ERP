"use client";

import { useRef, useState, useTransition } from "react";
import { Fingerprint, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { importPunchLog, type PunchImportResult } from "@/app/(app)/hr/attendance/actions";

export default function PunchImport({ companyId }: { companyId: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PunchImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const f = inputRef.current?.files?.[0];
    if (!f) { setRes({ ok: false, message: "Choose a punch-log file first." }); return; }
    const fd = new FormData();
    fd.set("file", f);
    setRes(null);
    start(async () => { setRes(await importPunchLog(companyId, fd)); });
  }

  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center gap-2 text-brand-navy">
        <Fingerprint className="h-5 w-5" />
        <h3 className="font-semibold">Import from punch machine</h3>
      </div>
      <p className="mb-3 text-xs text-muted">
        Upload the log your biometric device exports (CSV or text). We match each worker by their <span className="font-medium text-ink">biometric ID</span>,
        take the first punch in and last punch out per day, and fill attendance automatically.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-navy cursor-pointer">
          <Upload className="h-4 w-4" /> Choose file
          <input ref={inputRef} type="file" accept=".csv,.txt,.tsv,.dat,text/csv,text/plain"
            className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        </label>
        {fileName && <span className="text-sm text-ink">{fileName}</span>}
        <button onClick={submit} disabled={pending || !fileName} className="btn-primary disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Import punches
        </button>
      </div>

      {res && (
        <div className={clsx("mt-3 rounded-lg px-3 py-2 text-sm", res.ok ? "bg-brand-green/10 text-brand-green-700" : "bg-red-50 text-red-600")}>
          <div className="flex items-start gap-2">
            {res.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{res.message}</span>
          </div>
          {res.unmatched && res.unmatched.length > 0 && (
            <div className="mt-1.5 text-xs text-ink">
              Unmatched device IDs: <span className="font-mono">{res.unmatched.join(", ")}</span>.
              Set each worker&apos;s biometric ID on their profile to link them.
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted">
        Works with most devices (ZKTeco, eSSL, Matrix, Suprema). Live auto-sync straight from the device can be added once the model is confirmed.
      </p>
    </div>
  );
}
