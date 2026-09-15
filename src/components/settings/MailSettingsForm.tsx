"use client";

import { useState } from "react";
import { Send, ShieldCheck } from "lucide-react";
import { saveMailSettings, testMailSettings } from "@/app/(app)/settings/email/actions";
import {
  SECURITY_MODES, SECURITY_HELP, MAIL_PRESETS, presetFor, defaultPortFor, checkSettings,
} from "@/lib/mailsettings";

export type Existing = {
  host: string;
  port: number;
  security: string;
  username: string | null;
  hasPassword: boolean;
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  isActive: boolean;
};

/**
 * Setting up the company's mail server.
 *
 * Presets first, because the commonest failure is not a wrong password but a
 * wrong server: people type outlook.com, or port 465 with STARTTLS, and then
 * spend an afternoon on it. Choosing Microsoft 365 fills all three in.
 *
 * The password box is empty even when one is saved. It cannot show the real
 * one, and showing dots that overwrite on save would wipe the password every
 * time somebody changed the port — so blank means "leave it", and clearing is
 * its own tick box.
 */
export default function MailSettingsForm({
  companyId,
  existing,
  defaultTestTo,
}: {
  companyId: string;
  existing: Existing | null;
  defaultTestTo: string;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [preset, setPreset] = useState(existing ? "custom" : "m365");
  const [host, setHost] = useState(existing?.host ?? presetFor("m365").host);
  const [port, setPort] = useState(String(existing?.port ?? 587));
  const [security, setSecurity] = useState(existing?.security ?? "STARTTLS");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState(existing?.fromEmail ?? "");
  const [testTo, setTestTo] = useState(defaultTestTo);

  const chosen = presetFor(preset);
  const willHavePassword = clearPassword ? false : password ? true : !!existing?.hasPassword;

  const fit = checkSettings({
    host, port: Number(port), security, username,
    hasPassword: willHavePassword, fromEmail,
  });

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = presetFor(key);
    if (p.host) setHost(p.host);
    setPort(String(p.port));
    setSecurity(p.security);
  };

  const run = async (name: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    setSaved("");
    setBusy(name);
    const res = await fn();
    setBusy("");
    if (!res.ok) setError(res.error ?? "That did not work");
    else {
      setSaved(name === "test" ? "Test sent. Check the inbox." : "Saved.");
      setPassword("");
      setClearPassword(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        action={async (fd) => { await run("save", () => saveMailSettings(fd)); }}
        className="card space-y-4 p-5"
      >
        <input type="hidden" name="companyId" value={companyId} />

        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Who provides your email</label>
          <select className="input" value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {MAIL_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">{chosen.note}</p>
        </div>

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-6">
            <label className="mb-1 block text-sm font-medium text-ink">Mail server</label>
            <input
              name="host" className="input font-mono" required
              value={host} onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.office365.com"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Port</label>
            <input
              type="number" name="port" className="input" required min="1" max="65535"
              value={port} onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <label className="mb-1 block text-sm font-medium text-ink">Security</label>
            <select
              name="security" className="input" value={security}
              onChange={(e) => {
                setSecurity(e.target.value);
                setPort(String(defaultPortFor(e.target.value)));
              }}
            >
              {SECURITY_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted">{SECURITY_HELP[security]}</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Sign in as</label>
            <input
              name="username" className="input"
              value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="quotes@yourcompany.ae"
            />
            <p className="mt-1 text-xs text-muted">
              The full mailbox address. Leave empty for a relay inside your own network.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Password
              {existing?.hasPassword && !clearPassword && (
                <span className="ml-1 font-normal text-brand-green-700">— one is saved</span>
              )}
            </label>
            <input
              type="password" name="password" className="input" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              disabled={clearPassword}
              placeholder={existing?.hasPassword ? "Leave empty to keep the saved one" : "App password"}
            />
            {existing?.hasPassword && (
              <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox" name="clearPassword"
                  checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)}
                />
                Clear the saved password
              </label>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Send as (name)</label>
            <input name="fromName" className="input" defaultValue={existing?.fromName ?? ""} placeholder="White & Bright" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Send as (address)</label>
            <input
              name="fromEmail" className="input" required
              value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}
              placeholder="quotes@yourcompany.ae"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Replies go to</label>
            <input name="replyTo" className="input" defaultValue={existing?.replyTo ?? ""} placeholder="optional" />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="isActive" className="mt-0.5" defaultChecked={existing?.isActive ?? true} />
          <span>
            <span className="font-medium text-ink">Email is switched on</span>
            <span className="mt-0.5 block text-xs text-muted">
              Turning it off stops anything being sent without losing the settings.
            </span>
          </span>
        </label>

        {!fit.ok && (
          <p className="rounded bg-brand-gold/10 p-2 text-xs text-ink">{fit.error}</p>
        )}
        {error && <p className="text-sm text-brand-gold">{error}</p>}
        {saved && <p className="text-sm text-brand-green-700">{saved}</p>}

        <div className="flex justify-end gap-2">
          <button disabled={!!busy || !fit.ok} className="btn-primary disabled:opacity-50">
            <ShieldCheck className="h-4 w-4" /> {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {existing && (
        <form
          action={async (fd) => { await run("test", () => testMailSettings(fd)); }}
          className="card space-y-3 p-5"
        >
          <input type="hidden" name="companyId" value={companyId} />
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Prove it works</h2>
          <p className="text-xs text-muted">
            Sends a short message to you, not to a customer. Finding out the server refuses us by sending
            rubbish to a client is an expensive way to learn.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-sm font-medium text-ink">Send a test to</label>
              <input
                name="to" className="input" required
                value={testTo} onChange={(e) => setTestTo(e.target.value)}
              />
            </div>
            <button disabled={!!busy} className="btn-ghost disabled:opacity-50">
              <Send className="h-4 w-4" /> {busy === "test" ? "Sending…" : "Send a test"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
