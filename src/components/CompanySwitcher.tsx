"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import clsx from "clsx";

export type SwitcherCompany = { id: string; code: string; name: string };
const STORAGE_KEY = "wb-erp.company";

export default function CompanySwitcher({ companies }: { companies: SwitcherCompany[] }) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && companies.some((c) => c.id === saved)) setCompanyId(saved);
    } catch {
      /* storage unavailable */
    }
  }, [companies]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (companies.length === 0) return null;
  const current = companies.find((c) => c.id === companyId) ?? companies[0];

  function pick(id: string) {
    setCompanyId(id);
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-brand-blue"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-brand-navy text-[10px] font-bold text-white">
          {current.code}
        </span>
        <span className="max-w-[10rem] truncate font-medium text-ink">{current.name}</span>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <Building2 className="h-3.5 w-3.5" /> Group companies
          </div>
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={clsx(
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-brand-paper",
                c.id === current.id && "bg-brand-paper"
              )}
            >
              <span className="grid h-6 w-6 place-items-center rounded bg-brand-navy text-[10px] font-bold text-white">
                {c.code}
              </span>
              <span className="flex-1 text-ink">{c.name}</span>
              {c.id === current.id && <Check className="h-4 w-4 text-brand-green" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
