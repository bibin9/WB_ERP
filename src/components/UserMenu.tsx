"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Bell, User, KeyRound, LifeBuoy } from "lucide-react";
import { logout } from "@/app/login/actions";

export default function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-line/60"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-blue text-sm font-semibold text-white">{initials}</span>
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-sm font-medium text-ink">{name}</div>
          <div className="text-xs text-muted">{role}</div>
        </div>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
          {/* Profile header */}
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-navy text-sm font-semibold text-white">{initials}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{name}</div>
              <div className="truncate text-xs text-muted">{email}</div>
              <span className="mt-1 inline-block rounded bg-brand-green/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-green-700">{role}</span>
            </div>
          </div>

          <div className="py-1">
            <Link href="/notifications" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-ink hover:bg-brand-paper">
              <Bell className="h-4 w-4 text-muted" /> Notifications
            </Link>
            <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-ink hover:bg-brand-paper">
              <KeyRound className="h-4 w-4 text-muted" /> My Account &amp; Password
            </Link>
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-ink hover:bg-brand-paper">
              <User className="h-4 w-4 text-muted" /> Settings
            </Link>
            <Link href="/help" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-ink hover:bg-brand-paper">
              <LifeBuoy className="h-4 w-4 text-muted" /> Help Center
            </Link>
          </div>

          <div className="border-t border-line py-1">
            <form action={logout}>
              <button type="submit" className="flex w-full items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
