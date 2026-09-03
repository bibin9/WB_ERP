"use client";

import { useState, useTransition } from "react";
import { Plug, Download, Loader2 } from "lucide-react";
import clsx from "clsx";
import { testTallyConnection, importLedgersFromTally } from "@/app/(app)/finance/tally/actions";

export default function TallyControls({ companyId }: { companyId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function test() {
    setMsg(null);
    start(async () => { const r = await testTallyConnection(companyId); setMsg({ ok: r.ok, text: r.message }); });
  }
  function importLedgers() {
    setMsg(null);
    start(async () => { const r = await importLedgersFromTally(companyId); setMsg({ ok: r.ok, text: r.message }); });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={test} disabled={pending} className="btn-navy disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Test connection
        </button>
        <button onClick={importLedgers} disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Import ledgers from Tally
        </button>
      </div>
      {msg && (
        <div className={clsx("rounded-lg px-4 py-2 text-sm", msg.ok ? "bg-brand-green/10 text-brand-green-700" : "bg-red-50 text-red-600")}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
