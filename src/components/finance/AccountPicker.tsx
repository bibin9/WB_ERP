"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type PickerAccount = { id: string; code: string; name: string };

/**
 * Type-to-search account selector.
 *
 * A plain dropdown is fine with fifteen accounts and unusable with a hundred and
 * eighty. Someone entering sixty vouchers a day works from the keyboard: type a
 * few letters of the name or the code, arrow to it, Enter. That is the habit
 * Tally built, and breaking it makes the system slower than what it replaces.
 */
export default function AccountPicker({
  accounts,
  value,
  onChange,
  autoFocus,
}: {
  accounts: PickerAccount[];
  value: string;
  onChange: (id: string) => void;
  autoFocus?: boolean;
}) {
  const selected = accounts.find((a) => a.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    // Match on code or name, and rank a prefix hit above one in the middle:
    // typing "cas" should land on Cash at Bank, not Petty Cash Advance.
    const scored = accounts
      .map((a) => {
        const code = a.code.toLowerCase();
        const name = a.name.toLowerCase();
        if (code.startsWith(q) || name.startsWith(q)) return { a, rank: 0 };
        if (name.includes(q) || code.includes(q)) return { a, rank: 1 };
        return null;
      })
      .filter(Boolean) as { a: PickerAccount; rank: number }[];
    return scored.sort((x, y) => x.rank - y.rank || x.a.code.localeCompare(y.a.code)).map((s) => s.a);
  }, [accounts, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(a: PickerAccount) {
    onChange(a.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
    } else if (e.key === "Enter") {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          className="input h-9 py-1.5 pr-7 text-sm"
          autoFocus={autoFocus}
          value={open ? query : selected ? `${selected.code} · ${selected.name}` : ""}
          placeholder="Type to find an account…"
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="account-options"
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>

      {open && (
        <ul
          id="account-options"
          ref={listRef}
          className="absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-panel"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No account matches “{query}”</li>}
          {matches.map((a, i) => (
            <li key={a.id} data-i={i}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(a)}
                className={
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm " +
                  (i === active ? "bg-brand-blue/10 text-ink" : "text-ink hover:bg-line/50")
                }
              >
                <span className="font-mono text-xs text-muted">{a.code}</span>
                <span className="truncate">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
