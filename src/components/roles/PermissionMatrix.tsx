"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { setRolePermission, setModulePermission } from "@/app/(app)/settings/roles/actions";
import { MODULES, ACTIONS, screensForModule, type PermMap } from "@/lib/rbac";

export default function PermissionMatrix({ roleId, perms }: { roleId: string; perms: PermMap }) {
  const [pending, start] = useTransition();

  const grantedCount = (moduleKey: string) =>
    screensForModule(moduleKey).filter((s) => (perms[s.key] || []).length > 0).length;

  // Open modules that already have some access granted
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const m of MODULES) o[m.key] = grantedCount(m.key) > 0;
    return o;
  });

  const toggleScreen = (screenKey: string, action: string, current: boolean) =>
    start(() => setRolePermission(roleId, screenKey, action, !current));
  const toggleModule = (moduleKey: string, action: string, allOn: boolean) =>
    start(() => setModulePermission(roleId, moduleKey, action, !allOn));

  return (
    <div className="space-y-2">
      {MODULES.map((m) => {
        const screens = screensForModule(m.key);
        const total = screens.length;
        const granted = grantedCount(m.key);
        const isOpen = open[m.key];

        return (
          <div key={m.key} className="overflow-hidden rounded-lg border border-line">
            {/* Module header */}
            <div className="flex items-center gap-2 bg-brand-paper px-3 py-2">
              <button
                type="button"
                onClick={() => setOpen((p) => ({ ...p, [m.key]: !p[m.key] }))}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <ChevronRight className={clsx("h-4 w-4 text-muted transition-transform", isOpen && "rotate-90")} />
                <span className="font-medium text-ink">{m.label}</span>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium",
                  granted === 0 ? "bg-line text-muted" : granted === total ? "bg-brand-green/10 text-brand-green-700" : "bg-brand-gold/15 text-brand-gold")}>
                  {granted === 0 ? "No access" : granted === total ? "Full module" : `${granted}/${total} screens`}
                </span>
              </button>

              {/* Per-action "all screens" bulk toggles */}
              <div className="hidden items-center gap-3 sm:flex">
                {ACTIONS.map((a) => {
                  const allOn = screens.length > 0 && screens.every((s) => (perms[s.key] || []).includes(a));
                  return (
                    <label key={a} className="flex w-14 items-center justify-center gap-1 text-[11px] text-muted" title={`${a} — all screens`}>
                      <input type="checkbox" checked={allOn} disabled={pending}
                        onChange={() => toggleModule(m.key, a, allOn)}
                        className="h-3.5 w-3.5 accent-[color:rgb(var(--brand-navy))]" />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Screens */}
            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase text-muted">
                      <th className="px-3 py-1.5 font-semibold">Screen</th>
                      {ACTIONS.map((a) => <th key={a} className="w-14 px-2 py-1.5 text-center font-semibold">{a}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {screens.map((s) => {
                      const acts = perms[s.key] || [];
                      return (
                        <tr key={s.key} className={clsx(pending && "opacity-70")}>
                          <td className="px-3 py-1.5 text-ink">{s.label}</td>
                          {ACTIONS.map((a) => {
                            const on = acts.includes(a);
                            return (
                              <td key={a} className="px-2 py-1.5 text-center">
                                <input type="checkbox" checked={on} disabled={pending}
                                  onChange={() => toggleScreen(s.key, a, on)}
                                  className="h-4 w-4 accent-[color:rgb(var(--brand-green))]" />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
