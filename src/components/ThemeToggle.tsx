"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "wb-erp.theme"; // "light" | "dark" | absent = follow the device

/** Day / night switch. With no saved choice the app follows the device setting,
 *  and keeps following it if the user changes it while signed in. */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = (() => {
      try { return localStorage.getItem(KEY); } catch { return null; }
    })();
    setDark(stored ? stored === "dark" : mq.matches);
    setReady(true);

    // Only follow the device while the user has not made their own choice.
    const follow = (e: MediaQueryListEvent) => {
      try { if (localStorage.getItem(KEY)) return; } catch { /* ignore */ }
      setDark(e.matches);
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", dark);
  }, [dark, ready]);

  function toggle() {
    setDark((v) => {
      const next = !v;
      try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* ignore */ }
      return next;
    });
  }

  const label = dark ? "Switch to day mode" : "Switch to night mode";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={dark}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-line/60 hover:text-ink"
    >
      {/* Before hydration both are hidden, so the icon never contradicts the theme. */}
      {ready && (dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />)}
    </button>
  );
}
