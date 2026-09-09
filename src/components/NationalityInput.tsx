"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { searchCountries } from "@/lib/countries";

/**
 * Nationality, searchable by country as well.
 *
 * The other master-data fields on this form use a plain datalist, which is
 * fine when the word you type is the word in the list. It is not fine here:
 * somebody typing "Philippines" means "Filipino", and a datalist has no way to
 * match one against the other. So this is a small combobox that searches both
 * and stores the nationality.
 *
 * It is still an ordinary text input underneath. Typing something that is not
 * on the list is allowed and saved as typed — a list of nationalities is never
 * complete enough to argue with somebody's passport.
 */
export default function NationalityInput({
  name,
  defaultValue = "",
  /** The company's own master-data nationalities, offered first. */
  extras = [],
}: {
  name: string;
  defaultValue?: string;
  extras?: string[];
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => searchCountries(value, extras), [value, extras]);

  const choose = (nationality: string) => {
    setValue(nationality);
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        name={name}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="input"
        placeholder="Type a nationality or a country"
        onChange={(e) => { setValue(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        // A click on an option fires after blur, so closing is deferred by a
        // tick — otherwise the list disappears before the click lands.
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open && matches[active]) {
            // Do not submit the form on the keystroke that picks a nationality.
            e.preventDefault();
            choose(matches[active].nationality);
          } else if (e.key === "Escape") { setOpen(false); }
        }}
      />

      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-card"
          onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}
        >
          {matches.map((c, i) => (
            <li key={`${c.nationality}-${c.country}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c.nationality)}
                className={clsx(
                  "flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm",
                  i === active ? "bg-brand-paper text-ink" : "text-ink hover:bg-brand-paper",
                )}
              >
                <span>{c.nationality}</span>
                {c.country !== c.nationality && <span className="text-xs text-muted">{c.country}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
