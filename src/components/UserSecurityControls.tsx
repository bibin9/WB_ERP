"use client";

import { useState, useTransition } from "react";
import { Lock, Unlock, KeyRound, Copy, Check, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { setUserLock, resetUserPassword } from "@/app/(app)/users/actions";

export default function UserSecurityControls({ userId, locked, isSelf }: { userId: string; locked: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleLock() {
    setErr(null);
    start(async () => {
      const r = await setUserLock(userId, !locked);
      if (!r.ok) setErr(r.error ?? "Failed");
    });
  }
  function reset() {
    setErr(null); setTemp(null);
    start(async () => {
      const r = await resetUserPassword(userId);
      if (r.ok && r.tempPassword) setTemp(r.tempPassword);
      else setErr(r.error ?? "Failed");
    });
  }
  function copy() {
    if (!temp) return;
    navigator.clipboard?.writeText(temp).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button onClick={reset} disabled={pending} title="Reset password"
          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-paper hover:text-heading disabled:opacity-50">
          {pending && !temp ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        </button>
        {!isSelf && (
          <button onClick={toggleLock} disabled={pending} title={locked ? "Unlock account" : "Lock account"}
            className={clsx("grid h-8 w-8 place-items-center rounded-lg hover:bg-brand-paper disabled:opacity-50",
              locked ? "text-red-600" : "text-muted hover:text-heading")}>
            {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </button>
        )}
      </div>

      {err && <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 shadow-panel">{err}</div>}

      {temp && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-line bg-surface p-3 shadow-panel">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-heading">Temporary password</span>
            <button onClick={() => setTemp(null)} className="text-muted hover:text-ink"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-brand-paper px-2.5 py-1.5">
            <code className="flex-1 select-all font-mono text-sm text-ink">{temp}</code>
            <button onClick={copy} title="Copy" className="text-muted hover:text-heading">
              {copied ? <Check className="h-4 w-4 text-brand-green-700" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">Share this securely with the user. They&apos;ll be asked to set their own password on next sign-in.</p>
        </div>
      )}
    </div>
  );
}
