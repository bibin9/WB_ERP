"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { PanelLeftClose, PanelLeftOpen, ChevronDown } from "lucide-react";
import { NAV, NAV_GROUPS } from "@/lib/data";
import { SCREENS } from "@/lib/rbac";
import { activeTenant } from "@/config/tenant";

const CKEY = "wb-erp.sidebar.collapsed";
const GKEY = "wb-erp.sidebar.groups"; // closed group keys

export default function Sidebar({ allowedScreens }: { allowedScreens: string[] }) {
  const pathname = usePathname();
  const allowed = new Set(allowedScreens);
  // A whole-module entry (Finance/HR) shows if ANY of its screens is allowed and lands on the first accessible one.
  const firstScreenHref = (moduleKey: string) => SCREENS.find((s) => s.module === moduleKey && allowed.has(s.key))?.href;
  const visibleNav = NAV.flatMap((i) => {
    if (i.alwaysShow) return [i];
    if (i.moduleLanding) {
      const href = allowed.has(i.screen) ? i.href : firstScreenHref(i.module);
      return href ? [{ ...i, href }] : [];
    }
    return allowed.has(i.screen) ? [i] : [];
  });
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(CKEY) === "1");
      const g = localStorage.getItem(GKEY);
      if (g) setClosed(new Set(JSON.parse(g)));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const n = !v;
      try { localStorage.setItem(CKEY, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });
  }
  function toggleGroup(key: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(GKEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const items = visibleNav;
  const initials = activeTenant.productName
    .split(" ").filter((w) => /[A-Za-z]/.test(w)).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function isActive(href: string) {
    if (pathname === href) return true;
    return href !== "/settings" && pathname.startsWith(href + "/");
  }

  function NavLink({ item }: { item: (typeof NAV)[number] }) {
    const active = isActive(item.href);
    const locked = item.phase > 1;
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={clsx(
          "group relative flex items-center rounded-lg text-sm transition-colors",
          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2",
          active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
        )}
      >
        {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-brand-green" />}
        <Icon className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-brand-blue" : "text-white/55 group-hover:text-brand-blue")} />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && locked && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/55">P{item.phase}</span>
        )}
      </Link>
    );
  }

  return (
    <aside
      className={clsx(
        "flex h-full shrink-0 flex-col border-r border-white/5 bg-brand-navy text-white",
        ready && "transition-[width] duration-200 ease-out",
        collapsed ? "w-[4.75rem]" : "w-64"
      )}
    >
      {/* Brand header + collapse toggle */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-sm font-bold tracking-tight">{initials}</span>
          <button onClick={toggleCollapsed} title="Expand menu" className="grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white">
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between px-5 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activeTenant.logoWhite} alt={activeTenant.productName} className="h-10 w-auto max-w-[70%] object-contain" />
          <button onClick={toggleCollapsed} title="Collapse menu" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white">
            <PanelLeftClose className="h-[18px] w-[18px]" />
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {NAV_GROUPS.map((g) => {
          const gItems = items.filter((i) => i.group === g.key);
          if (gItems.length === 0) return null;
          const isWorkspace = g.label === "";
          const isClosed = !isWorkspace && !collapsed && closed.has(g.key);

          // Collapsed rail: just icons with a divider between groups
          if (collapsed) {
            return (
              <div key={g.key} className="space-y-0.5">
                {!isWorkspace && <div className="mx-2 my-2 border-t border-white/10" />}
                {gItems.map((item) => <NavLink key={item.href} item={item} />)}
              </div>
            );
          }

          return (
            <div key={g.key} className="mt-1">
              {!isWorkspace && (
                <button
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/35 hover:text-white/60"
                >
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", isClosed && "-rotate-90")} />
                  <span>{g.label}</span>
                </button>
              )}
              {!isClosed && <div className="space-y-0.5">{gItems.map((item) => <NavLink key={item.href} item={item} />)}</div>}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-white/35">ERP v0.1 · Phase 1</div>
      )}
    </aside>
  );
}
