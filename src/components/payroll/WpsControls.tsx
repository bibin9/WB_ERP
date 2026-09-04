"use client";

import { useState, useTransition } from "react";
import { Landmark, Download, Loader2, Save } from "lucide-react";
import clsx from "clsx";
import { updateWpsConfig, generateWpsSif } from "@/app/(app)/hr/payroll/actions";

export function WpsSettings({ companyId, employerId, routing }: { companyId: string; employerId: string; routing: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2 text-brand-navy"><Landmark className="h-5 w-5" /><h2 className="font-semibold">WPS employer details</h2></div>
      <p className="mb-3 text-xs text-muted">Used to generate the bank SIF file. Get these from your WPS-registered bank / MOHRE.</p>
      <form action={async (fd) => { await updateWpsConfig(fd); setSaved(true); }} className="space-y-3">
        <input type="hidden" name="companyId" value={companyId} />
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Employer MOL / establishment ID</label>
          <input name="wpsEmployerId" defaultValue={employerId} className="input" placeholder="e.g. 1234567890123" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Employer bank routing code</label>
          <input name="wpsBankRouting" defaultValue={routing} className="input" placeholder="e.g. 302460010" />
        </div>
        <button type="submit" className="btn-navy"><Save className="h-4 w-4" /> {saved ? "Saved" : "Save WPS details"}</button>
      </form>
    </div>
  );
}

export function WpsDownload({ runId }: { runId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      const r = await generateWpsSif(runId);
      if (r.ok && r.content && r.filename) {
        const blob = new Blob([r.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        setMsg({ ok: true, text: r.missing?.length ? `Downloaded. Skipped ${r.missing.length} without WPS details: ${r.missing.join(", ")}` : "SIF file downloaded." });
      } else {
        setMsg({ ok: false, text: r.error ?? "Failed to generate" });
      }
    });
  }

  return (
    <div>
      <button onClick={run} disabled={pending} className="btn-navy disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download WPS SIF
      </button>
      {msg && <p className={clsx("mt-2 text-xs", msg.ok ? "text-brand-green-700" : "text-red-600")}>{msg.text}</p>}
    </div>
  );
}
